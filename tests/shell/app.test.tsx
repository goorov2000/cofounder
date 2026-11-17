import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import App from '../../src/App';

test('entry actions report unavailable AI and help preserves manual input', async () => {
  const user = userEvent.setup();
  localStorage.clear();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=>JSON.stringify({configured:false,reason:'',model:'gpt-6-luna',searchEnabled:false})}));
  render(<App />);
  expect(await screen.findByText('AI пока не подключён. Черновик сообщения можно сохранить здесь и отправить после подключения.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Есть идея/ }));
  const input = screen.getByRole('textbox', { name: 'Сообщение' });
  expect(input).toHaveFocus();
  await user.type(input, 'Приложение для планирования');
  const draft = (input as HTMLTextAreaElement).value;
  await user.click(screen.getByRole('button', { name: /Как работать/ }));
  expect(screen.getByRole('dialog')).toHaveAccessibleName(/Как работать/);
  await user.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(input).toHaveValue(draft);
  await user.click(screen.getByRole('button', { name: /Найти идею/ }));
  expect(input).toHaveValue(draft);
  expect(input).toHaveFocus();
  expect(screen.getByRole('alert', { name: 'Не удалось завершить действие' })).toHaveTextContent('AI пока не подключён. Черновик сообщения можно сохранить здесь и отправить после подключения.');
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/api/status'))).toBe(true);
  expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
});
