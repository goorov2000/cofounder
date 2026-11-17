# Offline historical grounding replay

`g4-failures.json` contains unchanged synthetic request/raw/evidence objects from
`.autopilot/2026-11-15-bot-core/evidence/g4-second/{live,ui}/failures.jsonl`.
`g4-own-price.json` preserves atoms from that directory's `c03-semantic-observations.json`.
No paid requests, ledger changes, or updates of the historical verdict are involved.
The test adapter only performs the normal server-owned envelope assembly and strips
nullable legacy fact URL/date fields, as the provider did.

| Defect | Cause | Fix / preserved boundary | Regression |
| --- | --- | --- | --- |
| D01 | U+0000 inside reply price | Reject controls with exact field diagnostic; regeneration must fix original model output | Raw rejects at message |
| D15 | Scenario includes old 5000 and units but cites only new 10000 utterance | Multiple exact historical message references already supported; guard preserved | Raw rejects; complete claim passes with actual prior own-price source |
| K06 | StaffKit 9490 and 12490 claim bound to one-price quote | One claim requires its quote; no cross-quote implicit union | Raw rejects claim1; both amounts pass as separate cited claims |
| Own price samples 1/2 | Explicit competitor average-check atom stored as our_project | Finite explicit competitor metric scope guard; no inferred price or units | Both reject; sample3 external_entity passes; own-price contrast still passes |
| B idea / competitors correction | Regex interpreted Russian service name «заточка» as «за точку» | Require word separation after preposition; retain slash notation | Unchanged complete raw outputs now pass; real mismatched denominator still rejects |
| B competitors unknown | Same false positive initially; then invented period per service | False positive fixed; unsupported period still rejects at precise field | Raw rejects price.period |
| A search | Invented price unit phrase «план до 10 сотрудников» not present in quote | Exact term guard preserved | Raw rejects price.unit |
| A idea correction | Attempt to change scope of existing atom | Immutable scope guard preserved | Raw rejects operation0.value.scope |
| B audience correction | Unsupported quantity/unit in atom | Quantity guard preserved | Raw rejects operation2.value.text |
| A competitors correction | Historical claim refs absent from recorded current evidence | Actual unchanged historical server read required | Raw rejects quoteId; no fabricated read |
| Accepted-value conflict | Server accepted patch later rejected by client final-state guard | Shared final-state accepted-scope check on both boundaries | Server/client reject without partial project mutation |
| Explicit title mapping | Wrong quoted page title could pass when it contained no dimensions | Exact title metadata binding checked before quantity grounding | Correct title passes; different title rejects |

This is deterministic regression evidence, not a new live acceptance result.

## Repair control cycle 2

`control-final-01.json` preserves complete request/raw/evidence records for K04
and C03-own-price request `abef394f-bbf9-4148-81b9-dc9eea16af7d` from the first
fixed control run. `f4-grounding-control.test.ts` covers both.

- K04 used generic short brand labels («Смены», «Окей, сделал!»), which do not
  promise an exact document title. Only explicit «точное название страницы» /
  «заголовок страницы» is checked as strict metadata. Generic labels receive no
  numeric-title exemption unless they exactly equal the trusted source title.
- After that correction, the unchanged K04 raw still has an independent typo in
  artifactDraft.body: `bek_offisom` instead of actual read URL `bek_ofisom`.
  It remains rejected, now at the precise field. The positive variant copies
  only that exact trusted URL into the draft, preserving all claims/operations;
  it does not rewrite the fixture or pretend the unchanged raw passed.
- Explicit competitor metrics in our_project remain rejected. The stable rule
  `competitor_metric_requires_external_entity` now reaches repair diagnostics
  with scope.subject; the validator never infers a price, unit, or entity ID.

Original two-test red proof: `.repair/2026-11-15/grounding-cycle2-red.log`.

The same fixture now also includes the unchanged **first** K04 generation from
control-final-01/live_model/model-output.jsonl. It proves that one repair receives
both claim3.text/ungrounded_quantity (0 and480 tied to one quote) and the independent
artifactDraft.body/unprovided_url. Independent diagnostics are bounded to10 total,
with only path/rule in relatedIssues; controls/schema remain strict initial checks.
The invalid repaired generation remains rejected. No programmatic URL correction
was added to production. Tests also cover aggregation limits, no mutation and
propagation of unexpected implementation errors.

## D13 atomic title metadata

`targeted-02-d13.json` preserves unchanged first/repaired D13-prepare outputs,
the exact request and read evidence. Before the fix, both reject because the
server-owned title «Годовой тариф» was interpreted as an asserted yearly period.
The narrow atomic fix excludes only a labelled exact title of an actually cited
same-project read from quantity checks. It does not mutate the stored atom text.

The unchanged repaired output now passes in full. The unchanged first output
still fails an independent conservative lexical unit check: its final negative
comparability sentence mentions «за точку», while the quote says «за пользователя».
That guard is retained; the recorded actual repair already uses a passing form.
No general semantic/negation understanding is claimed. Other titles, uncited
metadata, added yearly payment and unsupported amount/currency/unit/period still
reject. Red proof: `.repair/2026-11-15/grounding-d13-title-red.log`.

## Explicit competitor average-price key

`targeted-02-own-price.json` copies request, HTTP response and project state before
C03-own-price iteration3 from targeted-02/mock_tool/results.jsonl. Its explicit key
`competitor_average_price` escaped the earlier finite guard. The regression removes
only app-owned post-validation HTTP knowledgeSources decoration, leaving the raw
atom intact; it now rejects with competitor_metric_requires_external_entity before
mutation. Explicit average/avg price/check keys follow the same invariant. A test
variant scopes the same unknown atom to an unidentified external group, preserving
its unknown status and the exact original accepted own-price entry.

The existing atomic quantity guard now reports ungrounded_memory_quantity, including
the historical D13 first generation. Its unit-negation limitation remains a reject;
no negative clause, price, claim or unit is silently removed. Red proof is saved at
`.repair/2026-11-15/grounding-own-price-red.log`.

## Target03 read date and explicit ticket benchmark

`targeted-03.json` preserves complete D13-prepare first/repaired generations and
own-price iteration2 HTTP reply/request. D13 now recognizes exact labelled read
metadata («прочитана», «прочитано», «проверена», «проверено», «дата получения»)
against the actual cited same-project read's retrievedAt. Both unchanged outputs
pass. Effective dates, unsupported prices, wrong retrieval dates (including the
same individual digits reordered), and dates of uncited reads are not exempted.
A mismatch reports safe read_date_mismatch; atom text remains unchanged.

Explicit average/avg ticket keys and the finite phrase «средний чек конкурентов»
now require external_entity. Finite negated comparison forms («не средний…»,
«не подтверждённый средний…», «не фактический средний…») do not reclassify our own
price. This is a bounded lexical guard, not universal morphology or entailment.
Exact own-price iteration2 rejects; the same unknown atom scoped to an unidentified
external group passes without invented units. Red proof:
`.repair/2026-11-15/grounding-target03-red.log`.

## Full02 K05 history / URL punctuation / citation-only revisions

`control-final-02-k05-history.json` preserves exact first/repaired K05-history raw,
request and historical context. The referenced annual source was actually read in
that session at2026-11-15T13:30:16.092Z. Both otherwise valid claims say15ноября2026года;
the earlier ISO-only matcher rejected number15. The shared metadata formatter now
recognizes exactly generated Russian day/month/year from the trusted read date,
also with masculine прочитан/проверен. Wrong dates, made-up effective dates and
unlabelled prices remain rejected. Both raw outputs pass unchanged offline.

`f8-url-punctuation.test.ts` covers a separate proven synthetic counterexample:
a known plain prose URL followed by a period/comma was rejected while its proper
Markdown link passed. Request/reply prose fields share terminal-punctuation tokenization. Raw supplied
URLs are retained and a prose citation alias is permitted only after conventional
terminal punctuation is removed. Structured URL fields receive no alias. Explicit Markdown
URL destinations, autolinks and structuredsourceUrl remain strict. No displayed
text, path/query/encoding or source identity is repaired. This does not identify
the cause of UI02's missing raw output.

`tests/domain/fixtures/ui02-b-noop.json` preserves the actual B project backup.
Its trip_pricev2/v3/v4 have identical semantic fields and separate exact citations.
The regression reconstructs a fresh material baseline from this final backup,
retains all audit revisions and verifies it stays fresh through citation-only
updates. A later actual800price change invalidates material dependencies on v2/v3,
not just the most recentv4. Separate unit/negation/status changes still invalidate.
This is an offline reconstructed state replay, not a claim that the original
UI02 materials were fresh. Red/green logs are in independent/noop-ui02-* and
independent/k05-date-*, plus independent/url-punctuation-*.

The additional asymmetric user-message/history counterexample is red-proved in
independent/grounding-prose-numericdate-red.log. Known human prose URLs with final
punctuation can now be repeated without it; sourceUrl remains exact and the alias
never authorizes a trusted read. Explicit Markdown destinations/autolinks/reference
links remain literal. Exact DD.MM.YYYY retrieval metadata and optional zero-padded
Russian day are finite formats generated from the actual trusted date, not parsed
or guessed dates. Wrong/effective dates and price additions still reject.

Trusted result URL coverage: a real immutable pricing-page quote can itself contain
an exact legal-page URL. The same recursive tokenization now collects URLs from
trustedEvidence as well as request prose. Echoing that unchanged result and
repeating its exact quoted URL is allowed; the linked legal page is not thereby
read. F8 checks that a fabricated legal-page claim, unknown URL and modified
trusted evidence still reject. The actual quote/source version guards are unchanged.
Red/green evidence: independent/trusted-result-url-{red,green,tsc}.log.

`targeted-09-c10-bare-title.json` preserves both exact model outputText strings
(with SHA256), request, actual read results and operation alias metadata from
`.repair/2026-11-15/targeted-09/mock_tool` on2898f34. F10 resolves actual aliases
then performs the normal full reply validation; only the protocol-only empty
memoryOperations field is removed as in the original independent reproducer.
No claim, number, URL, text or cited source is corrected. Bare `Страница «title»`
now uses the existing finite exact-owned-read-title metadata exemption in both
claims and atoms. Annual payment outside that title, a different title/source
and foreign-project atomic grounds still reject. Red3failed/1pass; green4pass.
Evidence: independent/targeted-09-title-{red,green,tsc,affected,affected-additional}.log.

`full03-d07-entity.json` preserves both complete raw generations, SHA256, actual
request, operation alias metadata and all six actual read snapshots from full03
live D07 on6d180ff (request36c3ce42-2bd8-4cfa-81eb-6a12558e9609). F11 resolves
actual aliases then validates all four unchanged claims; no numeric, URL, quote or
claim correction. The observed `в описании Bitrix24` label identifies an exact
whole mixedletter/digit token present in the cited read host metadata. Only that
finite named context can exempt embedded digits from quantity comparison; raw
claim text remains unchanged. Unsupported standalone24, price5000RUB, Bitrix240,
year2026 outside the entity label, unread/foreign sources and unsupported tokens
continue to reject. This is not a universal semantic brand validator.
Red2fail/1pass, green3pass; evidence independent/d07-entity-proposal/.

`full03-labelled-titles.json` retains exact failed first-generation raw strings
(with SHA256), actual request, owned read catalogue and operation alias metadata
for D13prepare2 and C11-1 in full03mock on6d180ff. F12 performs actual alias
resolution and standard memoryPatch envelope construction; full reply claims,
operations, text, numbers and URLs remain unchanged. Only two observed finite
labels are added: `На прочитанной странице с названием «EXACTtitle»` and
`В полученной странице с заголовком «EXACTtitle»`. They exempt the exact title
of actually cited same-project reads, not arbitrary quotation. Wrong title,
wrong/foreign source, added annual payment, unsupported2027 effective year and
unsupported12000RUB still reject. Red2failed/1passed; green targeted8files39tests.
Logs: independent/full03-labelled-titles-{red,green,tsc}.log.
