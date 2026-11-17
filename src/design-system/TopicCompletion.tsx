import { Button } from './components';
import './topic-completion.css';

export function topicCompletionText(nextTitle?: string): string {
  return `В целом я всё понял. ${nextTitle ? `Следующая тема — «${nextTitle}» — теперь доступна. Можно перейти к ней или продолжить здесь.` : 'Основное по этой теме обсудили. Если есть что добавить, можем продолжить.'}`;
}

export function TopicCompletion({ nextTitle, onContinue }: { nextTitle?: string; onContinue?(): void }) {
  return <div className="ds-topic-completion" aria-label="Тема проработана">
    <p role="status">{topicCompletionText(nextTitle)}</p>
    {nextTitle && onContinue && <Button variant="ghost" onClick={onContinue}>Перейти к теме «{nextTitle}»</Button>}
  </div>;
}
