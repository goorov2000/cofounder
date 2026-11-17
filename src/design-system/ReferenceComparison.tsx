import { Card } from './components';

// Exact source tokens; application adaptations live in tokens.css. See research/theme-comparison.json.
const references = [
  { name: 'СберБизнес · Triplex', light: '#008985', dark: '#19BDB0', note: 'Рабочие кабинеты, формы и таблицы. Основа нашего интерфейса.', url: 'https://github.com/SberBusiness/triplex-next' },
  { name: 'SDDS Service', light: '#108E26', dark: '#24B23E', note: 'Зелёная тема. Похожий оттенок сам по себе не доказывает использование этой библиотеки.', url: 'https://plasma.sberdevices.ru/sdds-serv/' },
  { name: 'SDDS Service · Malachite', light: '#0C8688', dark: '#0DA8AB', note: 'Отдельный бирюзовый вариант темы Service.', url: 'https://plasma.sberdevices.ru/sdds-serv/' },
  { name: 'Plasma Web', light: '#2A72F8', dark: '#528EFF', note: 'Синий акцент в открытой теме для веб-приложений.', url: 'https://plasma.sberdevices.ru/web/' },
  { name: 'Plasma B2C', light: '#2A72F8', dark: '#3F81FD', note: 'B2C — имя библиотеки. Это не подтверждение стека СберБанк Онлайн.', url: 'https://plasma.sberdevices.ru/b2c/' },
  { name: 'Plasma Giga', light: '#122654', dark: '#FFFFFF', note: 'Тёмно-синий и белый акценты в опубликованных темах Giga.', url: 'https://plasma.sberdevices.ru/giga/' },
];
export function ReferenceComparison() {
  return <section id="references" className="ds-library-section"><Card title="Почему у Сбера разные оттенки" description="Сравнение токена акцентного текста в открытых темах и переданных HTML. Проверено 14.11.2026.">
    <div className="ds-reference-grid">{references.map(ref => <article key={ref.name}><a href={ref.url} target="_blank" rel="noreferrer">{ref.name} ↗</a><div className="ds-reference-colors"><span><i style={{ background: ref.light }} />{ref.light}<small>Светлая</small></span><span><i style={{ background: ref.dark }} />{ref.dark}<small>Тёмная</small></span></div><p>{ref.note}</p></article>)}</div>
    <p className="ds-library-footnote">Мобильные скриншоты СберБанк Онлайн показывают отдельный визуальный подход: зелёные действия, цветной фон и полупрозрачные карточки. В CoFounder цветовую палитру можно выбрать отдельно от светлого и тёмного режима. Геометрия и элементы общие, цвета адаптированы для читаемости. Полное исследование и ссылки на CSS-файлы — в документации проекта.</p>
  </Card></section>;
}
