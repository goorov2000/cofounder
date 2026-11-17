import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createProject } from '../../shared/domain';
import { ensureCore, importProjectCopy } from '../../shared/coreMemory';
import type { Message, MessageRevision } from '../../shared/types';
import { AnswerSources } from '../../src/features/workspace/AnswerSources';

const source: MessageRevision = { projectId: 'original', moduleId: 'idea', generation: 0, messageId: 'old-message', revision: 1, role: 'user', createdAt: '2026-11-01T10:00:00Z', content: 'Отчёт нужен директору.\nОтправка в Telegram обязательна. <script>это данные</script>' };
const answer: Message = { id: 'answer', role: 'assistant', createdAt: '2026-11-15T12:00:00Z', content: 'Ранее вы указали: «Отправка в Telegram обязательна.»', reply: { message: 'Ранее вы указали: «Отправка в Telegram обязательна.»', choices: [], artifactDraft: null, proposedFacts: [], historySources: [{ source, quotes: ['Отправка в Telegram обязательна.'] }] } };

describe('historical answer source navigation', () => {
  it('opens and focuses the full archived original using a real link, with source content escaped', async () => {
    const user = userEvent.setup();
    render(<AnswerSources message={answer}/>);
    const link = screen.getByRole('link', { name: /Открыть исходную реплику: Реплика пользователя · Идея/ });
    const target = document.getElementById(link.getAttribute('href')!.slice(1))!;
    expect(target).toHaveTextContent(source.content.replace('\n', ' '));
    expect(target.closest('details')).not.toHaveAttribute('open');
    link.focus(); await user.keyboard('{Enter}');
    expect(target.closest('details')).toHaveAttribute('open');
    expect(target).toHaveFocus();
    expect(target.querySelector('script')).toBeNull();
    expect(window.location.hash).toBe('');
    expect(screen.getByText('Отправка в Telegram обязательна.', { selector: 'blockquote' })).toBeVisible();
  });

  it('keeps historical originals addressable after copy/import and clearing the source conversation, without duplicate targets across answers', async () => {
    const project = ensureCore({ ...createProject(), id: source.projectId });
    project.modules.competitors.messages = [answer];
    const imported = importProjectCopy(JSON.parse(JSON.stringify(project)), 'imported-project');
    imported.modules.idea.messages = []; imported.modules.idea.generation = 1;
    const saved = imported.modules.competitors.messages[0];
    expect(saved.reply!.historySources![0].source.projectId).toBe(imported.id);
    render(<><AnswerSources message={saved}/><AnswerSources message={{ ...saved, id: 'second-answer' }}/></>);
    const links = screen.getAllByRole('link', { name: /Открыть исходную реплику/ });
    expect(links[0].getAttribute('href')).not.toBe(links[1].getAttribute('href'));
    for (const link of links) {
      await userEvent.click(link);
      const target = document.getElementById(link.getAttribute('href')!.slice(1))!;
      expect(target).toHaveFocus(); expect(target).toHaveTextContent('Отчёт нужен директору.');
      expect(target).toHaveTextContent('<script>это данные</script>');
    }
  });
});
