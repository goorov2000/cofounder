import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { RoutePanel } from '../../src/components/layout/RoutePanel';
import { MODULES } from '../../shared/modules';
import type { ModuleId, ModuleState, Project } from '../../shared/types';

test('nine ordered stages stay compact, block locked stages and keep saved stale material accessible', async () => {
  const modules = Object.fromEntries<ModuleState>(Object.keys(MODULES).map(id => [id, { messages: [], draft: '', proposal: null, artifact: null }])) as Record<ModuleId, ModuleState>;
  modules.audience.artifact = { title: 'Аудитория', body: 'Сохранённый материал', revision: 1, savedAt: '2026-11-14T00:00:00Z', stale: true };
  const project: Project = { id: 'test', name: 'Тест', description: '', stageLabel: '', prototypeUrl: '', createdAt: '', updatedAt: '', isDemo: false, facts: {}, modules, activeModule: 'idea', calculations: {} };
  const onModuleChange = vi.fn();
  render(<RoutePanel project={project} onModuleChange={onModuleChange} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(9);
  expect(screen.getByRole('button', { name: /Рынок/ })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.queryByText(/Сначала сохраните/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Рынок' }));
  expect(onModuleChange).not.toHaveBeenCalled();
  const saved = screen.getByRole('button', { name: 'Аудитория' });
  expect(saved).not.toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByText('Контекст изменился')).toBeVisible();
  await userEvent.click(saved);
  expect(onModuleChange).toHaveBeenCalledWith('audience');
});
