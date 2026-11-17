import { useState } from 'react';
import { ArrowLeft, Check, ChevronRight, FileText, MessageSquare, Plus, Settings2, X } from 'lucide-react';
import { Alert, Button, Card, EmptyState, Field, Status } from './components';
import { ThemeControl } from './ThemeControl';
import { PaletteControl } from './PaletteControl';
import { PALETTES } from './palettes';
import { BrandMark } from './BrandMark';
import { ChatComposer } from './ChatComposer';
import { CopyConversationButton } from './CopyConversationButton';
import { formatConversation } from '../lib/conversation';
import { ProjectPanel } from './ProjectPanel';
import { TopicCompletion } from './TopicCompletion';
import { createProject, saveArtifact } from '../../shared/domain';
import { MODULES } from '../../shared/modules';
import { coverageBasis, TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import { AnswerChoices } from './AnswerChoices';
import { AssistantActions } from './AssistantActions';
import { UserMessage } from './UserMessage';
import { AIDisclaimer } from './AIDisclaimer';
import { ThinkingIndicator } from './ThinkingIndicator';
import { StageIntroExample } from './StageIntroExample';
import { MotionExample } from './MotionExample';
import { CalculationExample } from './CalculationExample';
import { useReadAloud } from '../hooks/useReadAloud';
import { useTheme } from './theme';
import { Modal } from '../components/ui/Modal';
import { Markdown } from '../components/ui/Markdown';
import { ReferenceComparison } from './ReferenceComparison';
import { AnswerSources } from '../features/workspace/AnswerSources';
import type { Choice, Message } from '../../shared/types';
import './gallery.css';

const palette = [
  ['canvas', 'Фон приложения'], ['surface', 'Панель'], ['surface-muted', 'Вложенная область'],
  ['text', 'Основной текст'], ['accent', 'Ссылка и акцент'], ['action', 'Главное действие'],
] as const;
const navigation = [['overview', 'Основа'], ['components', 'Компоненты'], ['motion', 'Анимации'], ['workspace-example', 'Рабочий экран'], ['states', 'Состояния'], ['table', 'Таблица'], ['references', 'Референсы Сбера']] as const;
const exampleChoices: Choice[] = [{id:'companies',label:'Небольшим компаниям',description:'Заказы ведёт владелец или администратор',recommended:true},{id:'solo',label:'Частным мастерам',description:'Один человек отвечает за весь заказ'}];
const sourceExample: Message = { id: 'example-answer', role: 'assistant', content: 'Вы выбрали небольшие мастерские.', createdAt: '2026-11-15T10:00:00Z', reply: {
  message: 'Вы выбрали небольшие мастерские.', choices: [], artifactDraft: null, proposedFacts: [], historySources: [{
    source: { projectId: 'example-project', moduleId: 'idea', generation: 0, messageId: 'example-user', revision: 1, role: 'user', createdAt: '2026-11-14T10:00:00Z', content: 'Начинаем с небольших мастерских. Интервью ещё не проводились.' },
    quotes: ['Начинаем с небольших мастерских.'],
  }],
} };

export function DesignSystemPage() {
  const theme = useTheme();
  const [modal, setModal] = useState(false);
  const [project, setProject] = useState('Мастерская заказов');
  const [submitted, setSubmitted] = useState(false);
  const [choice, setChoice] = useState('companies');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState('');
  const [question, setQuestion] = useState('Хочу помочь небольшим мастерским принимать заказы и следить за сроками.');
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState('chat');
  const [panelExample, setPanelExample] = useState<string | null>(null);
  const [coverageExample, setCoverageExample] = useState(false);
  const [exampleProject, setExampleProject] = useState(() => {
    const example = saveArtifact(createProject(), 'idea', {title:'Мастерская заказов',body:'Помогаем небольшим мастерским принимать заказы.'});
    example.activeModule = 'audience';
    example.modules.audience.memory = { updatedAt: '2026-11-15T10:00:00Z', content: { facts: [{text:'Первые клиенты — небольшие мастерские.',evidence:'Небольшие мастерские'}], hypotheses:['Заказы теряются между чатами и записями.'], openQuestions:['Кто принимает заказы каждый день?'] } };
    example.modules.audience.memory.content.coverage = { rubricVersion: 1, moduleId: 'audience', items: TOPIC_CRITERIA.audience.map(criterion => ({ id: criterion.id, status: criterion.id === 'selection' ? 'covered' : criterion.id === 'segments' ? 'partial' : 'missing', note: criterion.id === 'selection' ? 'Для первого шага выбраны небольшие мастерские.' : criterion.sufficient, support: criterion.id === 'selection' ? { role: 'user', quote: 'Небольшие мастерские' } : null })), nextCriterionId: 'roles' };
    example.modules.audience.memory.content.review = { version: 1, status: 'completed', model: 'illustrative-example', subjectHash: 'a'.repeat(64), assessedAt: '2026-11-16T10:00:00Z',
      process: { status: 'passed', note: 'Помощник использует выбранный сегмент и уточняет роль покупателя.', checks: PROCESS_CHECK_IDS.map(id => ({ id, status: 'passed', reason: 'Иллюстрация проверки, без вызова модели.' })) },
      result: { status: 'in_progress', note: 'Сегмент выбран; нужно различить пользователя и покупателя.' }, nextAction: 'Разобрать, кто принимает заказы и оплачивает продукт.', errorCode: null };
    example.modules.audience.memory.coverageBasis = coverageBasis(example, 'audience');
    return example;
  });
  const [feedback, setFeedback] = useState<'up' | 'down'>();
  const [answer, setAnswer] = useState('Давайте уточним, кто будет пользоваться продуктом каждый день. Кому вы планируете его предложить?');
  const conversationText = formatConversation({ projectName: 'Мастерская заказов', stageTitle: MODULES[exampleProject.activeModule].title, messages: [
    { id: 'example-question', role: 'user', content: question, createdAt: '' },
    { id: 'example-answer', role: 'assistant', content: answer, choices: exampleChoices, createdAt: '' },
    ...(preview ? [{ id: 'example-preview', role: 'user' as const, content: preview, createdAt: '' }] : []),
  ] });
  const reader = useReadAloud(tab);
  const rows = [
    { title: 'Идея проекта', detail: 'Кому помогаем и какую задачу решаем', status: 'Сохранено', tone: 'success' as const, version: '2' },
    { title: 'Целевая аудитория', detail: 'Сегменты, задачи и первые интервью', status: 'В работе', tone: 'info' as const, version: '1' },
    { title: 'Конкуренты', detail: 'Сравнение решений и альтернатив', status: 'Не начато', tone: 'neutral' as const, version: '—' },
  ];
  return <div className="ds-library">
    <a className="skip-link" href="#library-main">К компонентам</a>
    <header className="ds-library-header"><a href="/" className="ds-library-brand"><BrandMark /><span>CoFounder <small>Дизайн-система</small></span></a><a href="/" className="ds-button ds-button--ghost"><ArrowLeft size={17} />В мастерскую</a></header>
    <aside className="ds-library-nav"><span className="ds-library-nav-title">Библиотека интерфейса</span><nav aria-label="Разделы дизайн-системы">{navigation.map(([id, title]) => <a href={`#${id}`} key={id}>{title}<ChevronRight size={15} /></a>)}</nav><div className="ds-library-note"><span className="ds-version">Версия 1.13</span><p>Общие компоненты.<br />Пять цветовых палитр.</p></div></aside>
    <main className="ds-library-main" id="library-main">
      <section className="ds-library-intro" id="overview"><div><p className="ds-kicker">ОСНОВА ИНТЕРФЕЙСА</p><h1>Ваше пространство.<br />Ваши цвета.</h1><p>Пять палитр, светлый и тёмный режимы. Одинаковые элементы и правила на каждом экране.</p></div><div className="ds-library-theme"><span>Оформление</span><div className="ds-example-row"><ThemeControl /><PaletteControl /></div><p>{PALETTES.find(palette => palette.id === theme.palette)!.name} · {theme.resolved === 'dark' ? 'тёмная' : 'светлая'}. Выбранное оформление применяется и в мастерской.</p></div></section>
      <Card title="Цвет и поверхности" description="Акцент показывает действие. Нейтральные поверхности разделяют рабочие области.">
        <div className="ds-palette">{palette.map(([token, title]) => <div className="ds-swatch" key={token}><div style={{ background: `var(--ds-${token})` }} /><strong>{title}</strong><code>--ds-{token}</code></div>)}</div>
      </Card>
      <div className="ds-library-grid">
        <Card title="Типографика" description="Одна гарнитура, четыре уровня внимания."><div className="ds-type-list"><div><span>32 / 40 · 500</span><p className="ds-type-h1">Ваш новый проект</p></div><div><span>24 / 30 · 500</span><p className="ds-type-h2">Проверка идеи</p></div><div><span>16 / 25 · 400</span><p>Сначала определим, кому нужен продукт и какую задачу он решает.</p></div><div><span>14 / 22 · 400</span><p className="ds-type-caption">Изменения сохранены в этом браузере</p></div></div><p className="ds-library-footnote">Onest — локальная замена SB Sans. Точные файлы шрифта в референсах отсутствуют.</p></Card>
        <Card title="Размеры и ритм" description="Компактные элементы внутри просторных панелей."><div className="ds-rhythm">{[4, 8, 12, 16, 24, 32].map(size => <div key={size}><span>{size}</span><i style={{ width: `${size * 4}px` }} /></div>)}</div><div className="ds-radius-samples"><span style={{ borderRadius: 'var(--ds-radius-control)' }}>8 <small>Элемент</small></span><span style={{ borderRadius: 'var(--ds-radius-card)' }}>16 <small>Карточка</small></span><span style={{ borderRadius: 'var(--ds-radius-panel)' }}>28 <small>Панель</small></span></div></Card>
      </div>
      <section id="components" className="ds-library-section"><div className="ds-section-heading"><h2>Компоненты</h2><p>Основные, второстепенные и опасные действия различаются с первого взгляда.</p></div>
        <div className="ds-library-grid"><Card title="Ожидание ответа"><ThinkingIndicator/><ThinkingIndicator message="Проверка источников 2: ищу сведения для сравнения…" startedAt={Date.now()-65000}/><p className="ds-library-footnote">Пока приходит ответ. Анимация и смена подписи отключаются при уменьшении движения.</p></Card><Card title="Кнопки"><div className="ds-example-row"><Button variant="primary" onClick={() => setModal(true)}><Plus size={18} />Создать проект</Button><Button onClick={() => setModal(true)}>Настроить</Button><Button variant="ghost" onClick={() => setModal(true)}>Подробнее</Button></div><div className="ds-example-row"><Button variant="primary" disabled>Продолжить</Button><Button busy>Сохраняем</Button><Button variant="danger" onClick={() => setModal(true)}>Удалить</Button><Button aria-label="Пример настроек" onClick={() => setModal(true)}><Settings2 size={20} /></Button></div><p className="ds-library-footnote">Высота 40 px. На сенсорном экране область нажатия — от 44 px. Фокус виден при навигации клавишей Tab.</p></Card>
        <Card title="Поля и формы"><form className="ds-example-form" onSubmit={event => { event.preventDefault(); setSubmitted(true); }}><Field label="Название проекта" value={project} onChange={event => { setProject(event.target.value); setSubmitted(false); }} placeholder="Например, мастерская заказов" error={submitted && !project.trim() ? 'Укажите название проекта.' : undefined} hint="Название можно будет изменить." /><div className="ds-example-row"><Button type="submit" variant="primary">Сохранить название</Button>{submitted && project.trim() && <Status tone="success">Сохранено в примере</Status>}</div></form></Card></div>
      </section>
      <section id="motion" className="ds-library-section"><div className="ds-section-heading"><h2>Анимации</h2><p>Движение показывает смену состояния и сохраняет связь между элементами. Действия выполняются сразу; анимация не задерживает работу.</p></div><MotionExample /></section>
      <section id="workspace-example" className="ds-library-section"><div className="ds-section-heading"><h2>Рабочий экран</h2><p>Разговор и компактная панель проекта в одном пространстве. Интерактивный пример без AI-запросов.</p></div>
        <Card title="Первый экран этапа" description="Название переезжает в шапку после первого сообщения. Открытие этапа и ввод черновика не запускают разговор."><StageIntroExample /></Card>
        <div className="ds-workspace-example"><Card className="ds-conversation-example" title={MODULES[exampleProject.activeModule].title} action={<div className="ds-example-row"><CopyConversationButton text={conversationText}/><Button variant="ghost" onClick={() => setModal(true)}>Как работать</Button></div>}>
          <><UserMessage className="ds-example-user-message" text={question} onRead={text => reader.read('example-user', text)} speaking={reader.speakingId === 'example-user'} voiceError={reader.error?.id === 'example-user' ? reader.error.text : undefined} onEdit={text => { reader.stop(); setQuestion(text); setAnswer('Что сейчас сложнее всего в этом процессе?'); setFeedback(undefined); return undefined; }} /><div className="ds-example-assistant"><p>{answer}</p></div><AnswerChoices label="Варианты аудитории" choices={exampleChoices} selectedId={choice} onChoose={option=>setChoice(option.id)} /><AssistantActions text={answer} feedback={feedback} onFeedback={setFeedback} onRegenerate={() => { reader.stop(); setFeedback(undefined); setAnswer('Кто сейчас принимает заказы в мастерской: владелец, администратор или сами мастера?'); }} onRead={text => reader.read('example', text)} speaking={reader.speakingId === 'example'} voiceError={reader.error?.id === 'example' ? reader.error.text : undefined} sources={<><p>Это пример интерфейса с вымышленной исходной репликой.</p><AnswerSources message={sourceExample}/></>} />{preview && <UserMessage className="ds-example-user-message" text={preview} onRead={text => reader.read('example-preview', text)} speaking={reader.speakingId === 'example-preview'} voiceError={reader.error?.id === 'example-preview' ? reader.error.text : undefined} onEdit={text => { reader.stop(); setPreview(text); return undefined; }} />}<ChatComposer className="ds-example-composer" label="Свой вариант" value={message} onChange={setMessage} onSend={() => { setPreview(message.trim()); setMessage(''); }} placeholder="Опишите вашу аудиторию" sendLabel="Добавить сообщение в пример" onDictate={() => setPreview('В мастерской микрофон добавляет текст в поле. Отправка — отдельно.')} /><AIDisclaimer/></>
        </Card><div className="ds-panel-example"><ProjectPanel key={`${exampleProject.id}:${exampleProject.activeModule}`} project={exampleProject} coverageUpdate={coverageExample?{reviewing:true,previous:exampleProject.modules[exampleProject.activeModule].memory?.content.coverage}:undefined} onModuleChange={activeModule=>setExampleProject(p=>({...p,activeModule}))} onCalculator={()=>setPanelExample('Расчёт — сценарий с числами, формулами и допущениями.')} /><Button variant="ghost" aria-pressed={coverageExample} onClick={()=>setCoverageExample(value=>!value)}>Показать ожидание проверки</Button></div></div>
        <Button variant="ghost" onClick={()=>setTab('summary')}>Открыть пример завершения темы</Button>{tab==='summary'&&<TopicCompletion nextTitle="Аудитория" onContinue={()=>{setPanelExample('Аудитория');setTab('chat');}}/>}
        <Modal open={panelExample!==null} onClose={()=>setPanelExample(null)} title="Пример панели проекта"><p>{panelExample}</p></Modal>
      </section>
      <Card title="Расчёт рынка" description="Сценарий из диалога, основания по запросу и ручные поправки. Все числа в примере вымышлены."><CalculationExample /></Card>
      <section id="states" className="ds-library-section"><div className="ds-section-heading"><h2>Состояния и обратная связь</h2><p>Статус передаётся словами и формой, дополнительно — цветом.</p></div><div className="ds-library-grid"><Card title="Сообщения"><div className="ds-example-stack"><Alert tone="success">Итог сохранён. Можно перейти к следующему этапу.</Alert><Alert tone="warning">Условия изменились. Проверьте расчёт перед продолжением.</Alert><Alert tone="danger">Не удалось сохранить. Текст остался в поле — попробуйте ещё раз.</Alert><Alert tone="info">Это гипотеза. Добавьте источник после проверки.</Alert></div></Card><Card title="Пустое состояние"><EmptyState icon={<FileText size={30} />} title="Здесь появятся ваши материалы" action={<Button onClick={() => setModal(true)}>Создать первый материал</Button>}>Начните с идеи проекта. Сохранённые итоги будут доступны в этом разделе.</EmptyState></Card></div></section>
      <Card title="Таблица в ответе" description="Строки заполняют рамку. Длинные подписи переносятся; широкую таблицу можно прокрутить."><div className="workspace-message"><Markdown>{`| При 100 подходящих обращениях | Оплаченные заказы | Выполненные заказы с учётом предела 18 |
| :--- | ---: | ---: |
| Конверсия 5% | 5 | 5 |
| Конверсия 10% | 10 | 10 |
| Конверсия 20% | 20 | 18 |`}</Markdown></div></Card>
      <section id="table" className="ds-library-section"><Card title="Материалы проекта" description="Пример таблицы: выравнивание, вторичный текст, статусы и числа." action={<label className="ds-table-filter"><span className="sr-only">Фильтр материалов</span><select className="ds-select" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Все материалы</option><option value="saved">Сохранённые</option></select></label>}><div className="ds-table-scroll" tabIndex={0} role="region" aria-label="Таблица материалов"><table className="ds-table"><thead><tr><th scope="col">Материал</th><th scope="col">Статус</th><th scope="col" className="ds-numeric">Версия</th><th scope="col"><span className="sr-only">Действие</span></th></tr></thead><tbody>{rows.filter(row => filter === 'all' || row.tone === 'success').map(row => <tr key={row.title}><td>{row.title}<small>{row.detail}</small></td><td><Status tone={row.tone}>{row.status}</Status></td><td className="ds-numeric">{row.version}</td><td><Button size="sm" variant="ghost" aria-label={`Открыть пример: ${row.title}`} onClick={() => setModal(true)}><FileText size={18} /></Button></td></tr>)}</tbody></table></div></Card></section>
      <ReferenceComparison />
      <footer className="ds-library-footer"><MessageSquare size={18} /><p>Правила, происхождение значений и ограничения — в <code>docs/design-system/README.md</code>. Все данные на этой странице — примеры.</p></footer>
    </main>
    <Modal open={modal} title="Пример диалогового окна" onClose={() => setModal(false)}><p>Короткое объяснение действия, одна основная кнопка и понятная возможность вернуться. Клавиша Escape закрывает окно и возвращает фокус.</p><div className="ds-example-row ds-dialog-actions"><Button onClick={() => setModal(false)}><X size={16} />Отмена</Button><Button variant="primary" onClick={() => setModal(false)}><Check size={16} />Готово</Button></div></Modal>
  </div>;
}
