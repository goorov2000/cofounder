import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Markdown } from '../../src/components/ui/Markdown';

test('Markdown renders readable structures while refusing executable markup and unsafe links', () => {
  const { container } = render(<Markdown>{`## Проверка гипотезы

- Поговорить с покупателем
- Записать неизвестное

| Решение | Статус |
| --- | --- |
| Цена | Гипотеза |

[Источник](https://example.com/source)

[Опасная ссылка](javascript:alert%281%29)

<script>alert('unsafe')</script>
<img src="x" onerror="alert('unsafe')" />`}</Markdown>);
  expect(screen.getByRole('heading', { name: 'Проверка гипотезы' })).toBeVisible();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('table')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Источник' })).toHaveAttribute('href', 'https://example.com/source');
  expect((screen.getByText('Опасная ссылка').getAttribute('href') ?? '')).not.toMatch(/^javascript:/);
  expect(container.querySelector('script, img, [onerror]')).toBeNull();
});
