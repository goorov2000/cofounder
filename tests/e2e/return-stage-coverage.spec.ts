import { test, expect } from '@playwright/test';
import { createProject } from '../../shared/domain';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import type { AssistantReply, ChatRequest, ModuleId, Project } from '../../shared/types';
import { expandCoverage, expandRoute } from './project-panel';

function assessedReply(moduleId: ModuleId, quote: string, historicalAudience = false): AssistantReply {
  return { message: `Сохранили обсуждение темы ${moduleId}.`, choices: [], artifactDraft: null, proposedFacts: [], memory: {
    facts: [], hypotheses: [], openQuestions: [], coverage: { rubricVersion: 1, moduleId, nextCriterionId: null,
      items: TOPIC_CRITERIA[moduleId].filter(criterion => !historicalAudience || criterion.id !== 'price_segment').map(criterion => ({ id: criterion.id, status: 'covered', note: `Сохранённое пояснение: ${criterion.label}.`, support: { role: 'user', quote } })),
    },
  } };
}

function completedTopics(): Project {
  let project = createProject();
  for (const moduleId of ['idea', 'audience', 'competitors'] as const) {
    const message = moduleId === 'idea' ? 'Помогаем заказать одежду под свой стиль.' : moduleId === 'audience' ? 'Начинаем с уже заказывающих и переделывающих.' : 'Сравним сервис с ателье и самостоятельным пошивом.';
    const request: ChatRequest = { requestId: `historical-${moduleId}`, projectId: project.id, moduleId, intent: 'message', message, context: { name: project.name, description: '', facts: [], artifacts: [], history: [] } };
    project.modules[moduleId].messages.push({ id: `user-${moduleId}`, role: 'user', content: message, requestId: request.requestId, createdAt: '2026-11-17T10:00:00Z' });
    project = applyAnswer(project, request, assessedReply(moduleId, message, moduleId === 'audience'));
    // This topic was completed under the historical five-criterion rubric.
    project.modules[moduleId].completedAt = '2026-11-17T10:00:00Z';
  }
  return { ...project, activeModule: 'competitors', unlockedStages: ['idea', 'audience', 'competitors', 'market'] };
}

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`returning from competitors retains assessments and can update the price segment at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    const project = completedTopics();
    const requests: ChatRequest[] = [];
    await page.route('**/api/**', route => {
      if (route.request().url().endsWith('/status')) return route.fulfill({ json: { configured: true, model: 'mock-only', reason: '', searchEnabled: false } });
      if (!route.request().url().endsWith('/chat')) return route.abort();
      const request = route.request().postDataJSON() as ChatRequest;
      requests.push(request);
      return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: assessedReply(request.moduleId, request.message) } });
    });
    await page.addInitScript(project => {
      if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] }));
    }, project);
    await page.goto('/');
    await expandRoute(page);
    await expect(page.getByText('Пройдено 3 из 9', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Аудитория', exact: true }).click();
    for (let pass = 0; pass < 2; pass++) {
      await expandCoverage(page);
      const panel = page.locator('.ds-project-panel'), progress = panel.getByRole('progressbar');
      await expect(progress).toHaveAttribute('aria-valuenow', '5');
      await expect(progress).toHaveAttribute('aria-valuemax', '6');
      await expect(progress).toHaveAttribute('aria-valuetext', 'Предыдущая оценка: 5 из 6. Обновится со следующим ответом');
      await expect(panel.getByRole('status')).toContainText('Показана предыдущая оценка.');
      await expect(panel.getByText('По предыдущей оценке осталось: ценовой сегмент и готовность платить')).toBeVisible();
      await expect(panel.getByText('Не оценено', { exact: true })).toHaveCount(0);
      await expect(page.locator('.ds-topic-completion')).toHaveCount(0);
      await expect(page.locator('.workspace-message.user')).toContainText(project.modules.audience.messages[0].content);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0]);
      expect(saved.modules.audience.memory).toEqual(project.modules.audience.memory);
      if (!pass) await page.reload();
    }
    expect(await page.locator('.ds-project-panel').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `.repair/2026-11-17-return-stage-coverage/audience-${width}-${theme}.png` });
    await expandRoute(page);
    await page.getByRole('button', { name: 'Идея', exact: true }).click();
    await expandCoverage(page);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '7');
    await expect(page.locator('.ds-project-panel').getByRole('status')).toContainText('Показана предыдущая оценка.');
    await expect(page.locator('.ds-topic-completion')).toHaveCount(0);
    await page.reload();
    await expandCoverage(page);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '7');
    await expandRoute(page);
    await page.getByRole('button', { name: 'Аудитория', exact: true }).click();
    if (width < 900) await page.keyboard.press('Escape');
    expect(requests).toHaveLength(0);
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await input.fill('Выбираю средний ценовой сегмент как гипотезу; бюджет и доплату проверим на последних заказах клиентов.');
    await input.press('Enter');
    await expect(page.locator('.workspace-message.assistant')).toHaveCount(2);
    await expandCoverage(page);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Обсуждено 6 из 6 критериев');
    await expect(page.locator('.ds-project-panel').getByRole('status')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].context.memories?.find(memory => memory.moduleId === 'audience')?.content.coverage).toBeUndefined();
    await page.reload();
    await expandCoverage(page);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
