# Roadmap

What is done, what is measured and rejected, and what is left — each item tied
to the judging criterion it serves. Sizes are honest guesses for one person.

Legend: ✅ done and tested · 📏 built, measured, kept off · ⏳ not started

## Done since submission

| item | criterion | evidence |
|---|---|---|
| ✅ Changing your mind — scoped vs reset retraction, `superseded` reported, struck-through chips | human-agent experience | 8 parser cases, 5 tool assertions |
| ✅ `revise_search` — take one thing back, keep the rest | human-agent experience | tools_test |
| ✅ `parse_only` — dry run of the reading before committing | human-agent experience, WebMCP leverage | tools_test |
| ✅ Catalog text never lands in an instruction-shaped field | execution, security | hostile product inserted in tools_test |
| ✅ Live mode on both `document.` and deprecated `navigator.modelContext`; defensive register/unregister | WebMCP leverage | native_test, three spec shapes |
| ✅ An open question survives a navigation | human-agent experience | persist_test, two page loads on one session |
| ✅ Fuzzer with invariants (never widen the pool on answer, never NaN budget, never ask below 12) | execution | 4,000 sentences, four seeds |
| 📏 Two-step greedy lookahead | — | worse; selection and stopping disagreed |
| 📏 Sequential policy, one value function | — | correctly formulated, same frontier as myopic on this catalog; available as `P.mode = "sequential"` |
| 📏 Ranking weight sweep | — | on a plateau; only unpriced-under-budget earns its keep |
| 📏 Patience pricing | — | shipped threshold implies h ≈ 0.19–0.38 per question; now a stated belief |
| ✅ Attributes backfilled from titles at build time | execution | coverage +3–4 pts/facet, pool 498 → 454; the ceiling for a titles-only catalog |
| ✅ One session generator for every benchmark | execution | seven drifted copies replaced; two README tables corrected |
| ✅ Engine split into vocabulary / parser / retrieval / policy with explicit dependencies | execution | 55 benchmark figures diffed to the digit before and after |
| ✅ Parser as a twelve-pass pipeline with a trace; `parse_only` returns it | human-agent experience | order pinned by test |
| ✅ App as a namespace; tool surface as a table | execution | 88 tool assertions unchanged |

## Next, in order of leverage

### 1. A real catalog  — ✅ done — every criterion

Every number in this repo rests on 1,204 synthetic products. The independent
implementation in `LUOaini1213/counterask` already runs on 9,901 real Amazon
items; the ByteSize project has a 50,000-item frozen catalog with slot
extraction already done. Port one of those in.

Done: the 9,901-item slice is the shipped catalog; the synthetic one is a
build target. What it changed is in the README — the noun is a category, the
category is askable one level at a time, coverage is the ceiling. Wrongly
filtered went 47% → 0.9% on real data; Hit@10 0.041 (keyword) → 0.314.

The one place a stronger model belongs is here — attribute extraction at
catalog-build time, offline, once — not in the decision loop.

### 2a. A benchmark that starts where shoppers start  — ✅ done

`npm run broad`: sessions from "shoes" / "clothing" down. Category asking
doubles Hit@10 (0.16 → 0.31, 8/8 shards) and cuts the pool 597 → 121 for half
a question more — the largest effect measured here, invisible to the leaf-level
benchmark.

### 2. Measure h  — ⏳ 1 day plus a live deployment — thoughtful use of WebMCP

`patience.mjs` turns the threshold into a belief about how often a shopper
walks away per question. The store cannot measure that from a benchmark, but a
deployed page can: log question-shown / question-answered / page-abandoned
events (no personal data, just the three counters) and h falls out. Then the
threshold is a measured quantity and the `minRemoved` frontier is a decision,
not a judgment.

### 3. Turn `sequential` on when the catalog earns it  — ⏳ 1 hour once #1 lands

On the synthetic catalog the myopic first question is almost always right
(material dominates), so planning buys nothing. On a real catalog with more
even coverage the best first question may depend on the second. Re-run
`frontier.mjs`; if the sequential curve sits above myopic at equal questions,
flip the default.

### 4. Structured input first  — ⏳ half a day — WebMCP leverage

In a real WebMCP session the agent has already understood the shopper. The
parser is the fallback for raw text. Reword the `search_products` description to
steer the agent toward structured input, and make `parse_only` the suggested
first call so the agent sees the reading before it commits. Measure with
`agentbench`-style sessions where the "agent" passes structured fields.

### 5. Number words and units  — ✅ done — execution

`under fifty dollars`, `no more than twenty five bucks`, `one hundred and
fifty`, `€40`, in a money context only; `one size` and `two pockets` are left
alone. A thirteenth parser pass, eight new cases.

### 6. Shard variance  — ✅ done — execution

`npm run shards`: every headline figure with its spread over 8 shards, and the
two contested comparisons paired on identical shards. Headline tables now quote
mean ± se to two decimals; one claim an earlier draft made ("held-out scores
higher") turned out to be inside the spread and was withdrawn.

## Not planned

- **An LLM in the decision loop.** The store's identity is zero-token,
  deterministic, explainable. The stronger model is the agent calling the tools.
- **Tuning `minRemoved` against the benchmark.** It can price the benefit of a
  question and not the cost. Use #2 instead.
- **Merging this repo's files over `LUOaini1213/counterask`.** Two codebases,
  same filenames, incompatible. Port ideas by hand, one at a time, with tests.
