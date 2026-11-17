import { Check, Sparkles } from 'lucide-react';
import type { Choice } from '../../shared/types';
import { Button } from './components';
import './answer-choices.css';

interface AnswerChoicesProps {
  choices: Choice[];
  onChoose(choice: Choice): void;
  disabled?: boolean;
  selectedId?: string;
  className?: string;
  label?: string;
}

export function AnswerChoices({ choices, onChoose, disabled, selectedId, className = '', label = 'Варианты ответа' }: AnswerChoicesProps) {
  if (!choices.length) return null;
  return <div className={`ds-answer-choices ${className}`} role="group" aria-label={label}>
    <ol className="ds-answer-choice-list">
      {choices.map((choice, index) => <li key={choice.id}>
        <Button className="ds-answer-choice" disabled={disabled}
          aria-pressed={selectedId === undefined ? undefined : selectedId === choice.id}
          onClick={() => onChoose(choice)}>
          <span className="ds-answer-choice-number" aria-hidden="true">{selectedId === choice.id ? <Check size={16} /> : index + 1}</span>
          <span className="ds-answer-choice-copy">
            <span className="ds-answer-choice-heading"><strong>{choice.label}</strong>{choice.recommended && <span className="ds-answer-choice-recommendation"><Sparkles size={13} aria-hidden="true" />Рекомендую</span>}</span>
            {choice.description && <small title={choice.description}>{choice.description}</small>}
          </span>
        </Button>
      </li>)}
    </ol>
  </div>;
}
