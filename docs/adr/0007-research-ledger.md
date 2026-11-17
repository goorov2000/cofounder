# ADR 0007 — bounded research within the existing AI ledger

Date: 2026-11-15. Status: implemented; model behaviour and live-search quality require the separately recorded acceptance runs.

## Decision

Every chat goes through a small semantic Responses planner, then optionally hosted OpenAI `web_search`, a bounded public HTTP reader, and the final structured response. Search works from any module. The planner sees project context but outputs only an action and a short public query; the search call receives that query, not the project JSON. Email addresses, phone-like strings, URLs and key-like tokens are removed from the outgoing query. The model is instructed to exclude private names, contacts, internal values and identifiers; this is not a proof that semantic redaction is infallible.

The configured `gpt-6-luna` and its verified standard rates remain unchanged: input $0.10/M, output $0.50/M, hosted search $0.01 per tool call. The search route is disabled for an unknown model or unverified tool rate. `AI_WEB_SEARCH=0` disables it explicitly. No new account or key is needed. Every Responses call uses `store:false`, `maxRetries:0`, `service_tier:default` and disabled truncation.

Before the first paid call, the root request reserves the complete conservative chain: two byte-based prompt estimates with 16,384 framing tokens each, final evidence allowance (6 × 12,000 × 4 bytes plus 16,384 framing tokens), planning output ≤1,024, search output ≤2,048, final output ≤configured maximum (at most 8,192), four 128,000-token search windows and three $0.01 tools. Four nano-USD of rounding headroom cover independently rounded child reserves. Actual normal completions charge summed token usage and actual tool calls once. Unknown steps retain their own entire reserve.

Limits: ≤3 hosted tool calls, ≤6 page reads, ≤1 MiB per page, ≤3 redirects, ≤10 seconds per page, ≤12,000 extracted characters per page, and ≤120 seconds for the whole chain. HTTP reading has no separate API fee but remains an auditable child operation. The existing configured ledger and budget are retained.

## Durable state and failure behaviour

SQLite adds an `operations` table keyed by protected session, request ID and operation ID. Each child is written before execution with its input hash and reserve, then completed/failed/unknown with charge, usage, safe metadata and timestamps. Root totals include child charges; child rows are never added again as separate budget consumption. A completed search followed by an unbilled final-generation rejection cannot turn the entire chain into a free retry. A started child becomes unknown after timeout/restart. Root tombstones and cached replies retain the existing idempotency, hash-conflict, concurrent-request and session-rotation protections. A new study after a final failure needs a new explicit user action/request ID and another admission check.

Search or page failure produces `failed`/`partial` research and its limitations for the final model. Successfully read sources remain available; unread pages have no quotes and cannot ground claims. Cancellation stops future steps, and potentially spent operations remain charged. SSE emits validated planning/searching/reading/composing events before ordinary message text. Nothing updates client memory until the completed reply is fully validated.

## Evidence boundary

Only URLs in real tool action sources or URL-citation annotations enter the reader; prose URLs do not. Every hop accepts only HTTP(S) on its standard port, no credentials, and public IPs after DNS resolution; all DNS answers are checked and a validated address is pinned to the request. Redirects repeat the same checks. Native requests bound bytes and time, refuse compressed/non-text payloads, strip scripts/HTML, and store exact excerpts with offsets into the bounded extracted text. Dates absent from the page remain unknown. These are page-reading proofs, not proof of real-world truth.

The final model can propose `memoryOperations` and `externalClaims`, but cannot assign the memory envelope, evidence catalogue or server versions. Claims must reference a read source/quote and preserve price amount, currency, unit, period and payment conditions (or explicit unknown). Numerical and term checks are conservative structural checks; they do not prove entailment, company identity, interpretation of negation or commercial reality. Those need C03/C04/C10/C11 evaluations. Corrupt control characters, including NUL inside a price, reject the whole completed reply.

Historical client evidence is not itself proof of server reading. A new patch/claim may use it only if the exact record is present in a completed read operation under the same protected session/project. Imported history remains visible but does not acquire a fresh server verification. New evidence and archived user-provided context remain distinguishable in the prompt. Neither page text nor user links can redefine server tools or promote `verified` (which still means user verification).

## Evaluation seam

`new OpenAIProvider(config, {transport?, reader?})` permits controlled page/tool data with a real final model. `createApp({provider, ledger?, config?})` is programmatic; there are no production environment switches or public HTTP QA fields. Mixed live evaluation must use a local HTTP app with the existing ledger and budget. Default tests inject fake transports/readers and a temporary ledger with no real key. Read metadata retains evidence for same-session historical validation; no secret or hidden chain of thought is logged.
