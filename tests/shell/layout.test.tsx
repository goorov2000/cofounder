import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { AppShell } from '../../src/components/layout/AppShell';

test('the shell exposes named destinations, active navigation and reversible route disclosure', async () => {
  const user = userEvent.setup();
  const onRouteChange = vi.fn();
  const onModuleChange = vi.fn();
  const { rerender } = render(<AppShell route="workspace" onRouteChange={onRouteChange} activeModule="idea" onModuleChange={onModuleChange} projectName="Мой проект" routePanel={<p>Этапы моего проекта</p>}><textarea aria-label="Ваше сообщение" defaultValue="Мой черновик" /></AppShell>);
  expect(screen.getByRole('button', { name: 'Свернуть меню' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Мастерская' })).toHaveAttribute('aria-current', 'page');
  await user.click(screen.getByRole('button', { name: 'Презентация' }));
  expect(onRouteChange).toHaveBeenCalledWith('presentation');
  await user.click(screen.getByRole('button', { name: 'MVP' }));
  expect(onModuleChange).toHaveBeenCalledWith('mvp');
  expect(screen.queryByText('Этапы моего проекта')).not.toBeInTheDocument();
  rerender(<AppShell route="presentation" onRouteChange={onRouteChange} activeModule="idea" onModuleChange={onModuleChange} projectName="Мой проект" routePanel={<p>Этапы моего проекта</p>}><textarea aria-label="Ваше сообщение" defaultValue="Мой черновик" /></AppShell>);
  await user.click(screen.getByRole('button', { name: 'Скрыть маршрут' }));
  expect(screen.queryByText('Этапы моего проекта')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Показать маршрут' }));
  expect(screen.getByText('Этапы моего проекта')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Свернуть меню' }));
  expect(screen.getByRole('button', { name: 'Развернуть меню' })).toHaveAttribute('aria-expanded', 'false');
  await user.click(screen.getByRole('button', { name: 'Развернуть меню' }));
  expect(screen.getByRole('button', { name: 'Свернуть меню' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('textbox')).toHaveValue('Мой черновик');
});
