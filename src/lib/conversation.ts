import type { Message } from '../../shared/types';

interface Conversation {
  projectName: string;
  stageTitle: string;
  messages: Message[];
  notice?: string;
  stream?: { text: string; replacesMessageId?: string };
}

/** Copy readable dialogue only; request snapshots and other chats stay in the workspace. */
export function formatConversation({ projectName, stageTitle, messages, notice, stream }: Conversation): string {
  const parts = [`CoFounder · ${projectName}\nЭтап: ${stageTitle}`];
  for (const message of messages) {
    const role = message.role === 'user' ? 'Вы' : 'Помощник';
    if (stream?.text && stream.replacesMessageId === message.id) {
      parts.push(`${role} (ответ ещё формируется):\n${stream.text}`);
      continue;
    }
    const status = message.status === 'pending'
      ? message.role === 'user' ? 'ожидаем ответ' : 'обновляем ответ'
      : message.status === 'failed' ? message.role === 'user' ? 'ответ не получен' : 'не удалось обновить ответ' : '';
    const lines = [`${role}${status ? ` (${status})` : ''}:`, message.content];
    if (message.role === 'assistant' && message.choices?.length) {
      lines.push('', 'Варианты ответа:', ...message.choices.map((choice, index) =>
        `${index + 1}. ${choice.label}${choice.recommended ? ' [Рекомендую]' : ''}${choice.description ? ` — ${choice.description}` : ''}`));
    }
    if (message.reply?.research?.status === 'partial' || message.reply?.research?.status === 'failed') {
      lines.push('', 'Исследование не завершено', ...message.reply.research.limitations);
    }
    if (message.requestError) lines.push(`Ошибка: ${message.requestError}`);
    parts.push(lines.join('\n'));
  }
  if (stream?.text && !stream.replacesMessageId) parts.push(`Помощник (ответ ещё формируется):\n${stream.text}`);
  if (notice) parts.push(`Уведомление:\n${notice}`);
  return parts.join('\n\n---\n\n');
}
