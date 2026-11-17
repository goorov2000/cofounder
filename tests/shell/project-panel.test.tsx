import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createProject } from '../../shared/domain';
import { ProjectPanel } from '../../src/design-system/ProjectPanel';

test('the first message opens coverage; later replies preserve manual selection; reset and navigation restore the right default', () => {
  let project = createProject();
  const props = { onModuleChange: vi.fn(), onCalculator: vi.fn() };
  const view = render(<ProjectPanel project={project} {...props} />);
  const route = () => screen.getByRole('button', { name: 'Маршрут проекта' });
  const coverage = () => screen.getByRole('button', { name: 'Проработка темы' });
  expect(route()).toHaveAttribute('aria-expanded', 'true');
  project.modules.idea.draft = 'Набранный текст ещё не разговор';
  view.rerender(<ProjectPanel project={project} {...props} />);
  expect(route()).toHaveAttribute('aria-expanded', 'true');
  project.modules.idea.messages = [{ id: 'one', role: 'user', content: 'Первая реплика', createdAt: '' }];
  view.rerender(<ProjectPanel project={project} {...props} />);
  expect(route()).toHaveAttribute('aria-expanded', 'false');
  expect(coverage()).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Контекст проекта' }));
  project.modules.idea.messages.push({ id: 'two', role: 'assistant', content: 'Ответ', createdAt: '' });
  view.rerender(<ProjectPanel project={project} {...props} />);
  expect(screen.getByRole('button', { name: 'Контекст проекта' })).toHaveAttribute('aria-expanded', 'true');
  expect(coverage()).toHaveAttribute('aria-expanded', 'false');
  project = { ...project, activeModule: 'audience' };
  view.rerender(<ProjectPanel project={project} {...props} />);
  expect(route()).toHaveAttribute('aria-expanded', 'true');
  project = { ...project, activeModule: 'idea' };
  view.rerender(<ProjectPanel project={project} {...props} />);
  expect(coverage()).toHaveAttribute('aria-expanded', 'true');
  project.modules.idea.messages = [];
  view.rerender(<ProjectPanel project={project} {...props} />);
  expect(route()).toHaveAttribute('aria-expanded', 'true');
  expect(coverage()).toHaveAttribute('aria-expanded', 'false');
});

test('a restored conversation starts on coverage and hidden sections cannot receive focus', () => {
  const project = createProject();
  project.modules.idea.messages = [{ id: 'saved', role: 'user', content: 'Сохранённый разговор', createdAt: '' }];
  const view = render(<ProjectPanel project={project} onModuleChange={vi.fn()} onCalculator={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Проработка темы' })).toHaveAttribute('aria-expanded', 'true');
  const route = view.container.querySelector('.ds-project-route .ds-disclosure')!;
  expect(route).toHaveAttribute('inert');
  expect(route).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('button', { name: 'Идея' })).not.toBeInTheDocument();
});
