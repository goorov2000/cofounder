import type { Page } from '@playwright/test';

export async function openProjectPanel(page: Page) {
  // Let the preceding module change finish its effect before opening its drawer.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const drawer = page.getByRole('button', { name: 'Открыть панель проекта', exact: true });
  const show = page.getByRole('button', { name: 'Показать панель проекта', exact: true });
  if (await drawer.isVisible() && !await page.getByRole('dialog', { name: 'Панель проекта', exact: true }).isVisible()) await drawer.click();
  else if (await show.isVisible()) await show.click();
}

export async function openCompletionExample(page: Page) {
  await page.getByRole('button', { name: 'Открыть пример завершения темы', exact: true }).click();
}

export async function expandCoverage(page: Page) {
  await openProjectPanel(page);
  const coverage = page.getByRole('button', { name: 'Проработка темы', exact: true });
  if (await coverage.getAttribute('aria-expanded') === 'false') await coverage.click();
}

export async function expandContext(page: Page) {
  await openProjectPanel(page);
  const context = page.getByRole('button', { name: 'Контекст проекта', exact: true });
  if (await context.getAttribute('aria-expanded') === 'false') await context.click();
}

export async function expandRoute(page: Page) {
  await openProjectPanel(page);
  const route = page.getByRole('button', { name: 'Маршрут проекта', exact: true });
  if (await route.getAttribute('aria-expanded') === 'false') await route.click();
  // Wait for layout motion before clicking a moving stage or measuring bounds.
  await page.locator('.ds-project-route .ds-disclosure').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
}
