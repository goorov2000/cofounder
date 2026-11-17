# ADR 0013 — Exact request-local source aliases for model output

2026-11-15. Status: implemented; offline integration passes, fresh paid acceptance remains pending. This does not revise historical failures.

## Problem

Full control 02 K04 corrupted long source IDs while otherwise attempting to cite read evidence. The model changed `web-398fef82f15b19f188ac3046` to a different ID and omitted the final character of `web-16582b1a9f73ce4d5a96196d`. These outputs must remain invalid. String similarity or quote matching cannot authorize replacement IDs.

## Protocol

Each OpenAIProvider completion owns an immutable bijection from exact actual `(evidenceId, version)` to `source_1`, `source_2`, etc., over the union of actual research evidence and trusted historical evidence supplied by the server. Identical catalogue entries share one alias; conflicting content under the same identity is rejected. The map is local to the completion and reused for its existing single generation repair.

A cloned model input projects only catalogue `id` and typed external references in current/historical core entries. Actual atomic IDs, message references, versions, `quote-N` IDs, source text, prices, dates, URLs and trust status are unchanged. Untrusted historical references do not acquire aliases. A collision between an unbacked historical ID and a reserved alias is rejected rather than silently binding it to another source. Original request and evidence objects are not mutated.

The model copies an alias into the existing structured `evidenceId` field. Before normal parsing/grounding, the server resolves only `externalClaims[].evidenceId` and external `memoryOperations[].value.sources[].evidenceId`. Both alias and version must match exactly. Unknown aliases, raw stable IDs in alias fields, altered versions, truncated IDs and approximate spellings are rejected. Quote ownership/content, URLs, quantities and memory transitions still pass through all existing normal guards using the actual catalogue.

Alias errors contain only safe paths/rules, with bounded related issues; no lookup values or quotations are copied into public errors. No source is accepted by guessing. Both raw attempts stay charged and traced. Paid operation metadata records the protocol version and exact alias-to-actual-ID/version mapping; model raw uses aliases and final replies/cache/state use stable actual references. Historical reads retain their original dates and never become new reads.

## Cost, atomicity and transport

No additional paid step is introduced. Planning, optional single plan repair, search, generation and optional single generation repair retain the existing bounds. The fixed alias instruction fits the existing input-overhead allowance. Real server IDs shorten; a deterministic positive-expansion upper bound for short injected IDs is added before reservation, based on the known request catalogue/reference count and up to six new pages. Tests compare both generated inputs with their child reserves, including the JSON-encoded rejected output in repair. The installation cap, model and output-token limit do not change.

Streaming text remains provisional. An alias failure uses the existing text-reset event before the sole repair. No partial memory patch is applied. Only the fully resolved and normally validated reply reaches complete/cache/state. Refusal, incomplete output, missing usage or unknown network outcomes do not become repairable through this protocol.

## Verification and limits

Tests cover exact resolution, same actual ID at two versions, duplicate/colliding catalogues, historical references/dates, untrusted reserved-namespace collisions, per-request isolation, unknown aliases, wrong versions, unchanged quote/URL/amount validation, both memory/claim fields, both validation traces, SSE reset and cost bounds. Existing mock transports must return the new model-facing alias protocol; stable server validation fixtures remain unchanged.

Aliases improve reference copying, not semantic correctness. A valid alias does not prove that a claim follows from a quote, that a source is current, that a URL is official or that a method was applied. Existing source, quantity, status and memory guards and independent semantic acceptance remain necessary. Replay of cached canonical replies is unaffected; aliases are not persisted as evidence identities.
