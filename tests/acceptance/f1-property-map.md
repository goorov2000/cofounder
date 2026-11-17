# F07: исходные свойства и раздельные наблюдения

46 исходных expected/forbidden и разделение 29/17 не менялись. Одноходовой HTTP не подтверждает кэш, поздний ответ или устаревание оценки. Следующие привязки являются частью исполнимого индекса C06/C07; pass ставится только после проверки обеих колонок.

| ID / исходное свойство | Воспроизводимый state/browser test | Отдельное live observation после F1 |
|---|---|---|
| D13: новая версия цены | f1-fixtures.test.ts: `F07 D13 applies the new price…` | D13 ×3: извлечение изменения из исходной фразы и активная версия 3500 |
| D13: расчёт рынка и оценка устарели | Тот же тест: настоящий calculation, artifact, assessment до ответа; staleReason и снятая assessment после | В каждой строке D13 results сравнить stateBefore/stateAfter, старые значения, staleReason и отсутствие актуальной оценки |
| D13: тариф конкурента не переписан | Тот же тест: отдельная external_entity запись неизменна | В каждой строке D13 отдельно сравнить внешний тариф и происхождение, не считать его верифицированным автоматически |
| D18: нет решений и документов A | storage.test.tsx: `persists drafts, isolates projects and retains captured project targeting across reload and import` | В UI создать ресторан A, затем велосипед B, спросить «Кто наш клиент?». Сохранить оба проекта до/после и проверить отсутствие ресторанных вводных в B |
| D18: кэш не подмешивает A | api.test.ts: `deduplicates owner + id + body across concurrent calls and restarts, preserving budget reservations` (другой проект/сессия и повтор ID); storage.test.tsx targeting test | Ответ на тот же вопрос в A, затем B через ту же сессию; сохранить разные requestId, HTTP и ответ B. Одноходовой D18 не покрывает этот пункт |
| D18: только данные B и общая методика | storage.test.tsx targeting test; core-memory.test.ts foreign conversation rejection | Тот же отдельный UI ответ B: независимая проверка всех утверждений и method refs |
| D19: старая идея не возвращается | restart.test.ts: `does not restore discarded ideas from older downstream context…` | Перезапустить A с зависимыми итогами, описать велосипед, новый живой ответ не содержит ресторана |
| D19: поздний ответ не записан | answerRequests.test.ts: `ignores a late response after restarting its conversation`; restart-chat.spec.ts: `restarting while waiting cancels the old request…` | Зафиксировать старый pending request, reset/new generation, новый ответ; старый request не повторять платно. Принудительно задержанный ответ проверяется browser mock отдельно |
| D19: зависимые итоги требуют пересмотра | restart.test.ts: `restarts one stage durably while preserving the project and other conversations`; restart-chat.spec.ts local/durable | Снять состояние/видимые stale зависимых итогов до reset, после reset и после нового ответа |

Команды без ключа: `OPENAI_API_KEY='' AI_BUDGET_USD=0 npx vitest run tests/acceptance/f1-fixtures.test.ts tests/domain/restart.test.ts tests/workspace/answerRequests.test.ts tests/domain/storage.test.tsx tests/server/api.test.ts`.
Browser: отдельный UI3010, затем `OPENAI_API_KEY='' AI_BUDGET_USD=0 T06_ACCEPTANCE_URL=http://localhost:3010 npx playwright test tests/e2e/restart-chat.spec.ts tests/e2e/user-message-actions.spec.ts`.
Live исходные D13/D18/D19 и дополнительные UI observations не объединять: отдельные evidence файлы и независимая разметка; пока not_run.
