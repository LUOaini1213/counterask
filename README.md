# Counterask — a store that asks back

A menswear storefront whose WebMCP tools return **a question** when answering
would be a guess. No server, no model call, no tokens: the whole store is one
page.

An independent implementation of the idea, not a copy of anyone's code. It ships
on **9,901 real menswear products** — the level-2 "Men" slice of the frozen
Amazon Reviews 2023 catalog (McAuley Lab, UCSD), with attributes as extracted by
`LUOaini1213/counterask` — and can be rebuilt on a 1,204-product synthetic
catalog that every experiment was first run on. `npm run catalog:real -- <json>`
and `npm run catalog:synthetic` switch between them; nothing else changes.

## Open it

**Live:** <https://luoaini1213.github.io/counterask/>

- `counterask-demo.html` — one self-contained file on the real catalog, 2.9 MB.
  Double-click it. `counterask-demo-lite.html` is the same page on the synthetic
  catalog at 107 KB.
- Or `npm start` and open `http://localhost:5173`.
- `?agent=demo` in the URL starts the scripted agent on load.
- `npm test` runs the parser cases, the fuzzer, the tool surface, the page, the
  bundled file, and both benchmarks.

Web fonts come from Google Fonts; offline the page falls back to Georgia and
the system sans and still works.

## What it does

`search_products` returns one of two things.

    { "status": "answer", "candidates": 22,
      "products": [ … ],
      "differentiators": [ { "facet": "material",
                             "splits": [ {"value":"nylon","count":10}, … ] } ],
      "why": ["Best question would only clear ~10 of 22 candidates — not worth a turn."] }

    { "status": "need_more_evidence",
      "question": "What material are you after — leather, nylon, canvas, suede?",
      "facet": "material",
      "options": [ {"value":"leather","count":57}, … ],
      "why": ["96 candidates, leader only 5% ahead.",
              "Asking “material” clears ~50 of them on average (recorded on 90%)."],
      "note": "Answering now would be a guess. Put this question to the shopper,
               then call answer_question." }

When it asks, it returns no ranked answer — half a ranking presented as an
answer is the thing this store exists not to do. It does return a capped
`candidate_sample`, named for what it is, because the person can see the
candidate grid behind the question and an agent that cannot is a second, worse
surface. Without it the agent also has no ids, so `show_products` is unusable
until the question is answered.

Each result is MCP-shaped: `content` carries the JSON as text,
`structuredContent` carries the object.

## Reading a sentence, not a search box

A search box gets `leather belt`. An agent relaying a person gets *"I'm looking
for a leather belt, nothing with a snap, not over $50"*. Fed to a keyword
matcher that sentence goes wrong three ways at once: it requires "looking" and
"over" to appear in a title, it reads "snap" as a requirement rather than a
refusal, and it never sees the budget.

The parser runs in a fixed order and blanks every span it claims, so a word read
one way is never read again another way:

| Pass | Reads | Example |
|---|---|---|
| contractions | `isn't` → `is not` | otherwise the refusal is invisible |
| protected compounds | hyphenated names | `no-show` is a name, not a refusal |
| size | sizes this catalog has no data for | `size 10` → reported as ignored |
| number words | fifty, twenty-five, a hundred and fifty, €40 — in a money context only | `under fifty dollars`; `one size` is left alone |
| budget | ceilings, floors, ranges, approximations | `not over $50`, `nothing over $200`, `about $150` |
| ordering | cheapest, best rated, most popular | `cheapest wool sweater` |
| waved through | "any … is fine", "no preference on" | `any material is fine` → never asked about |
| refusals | not, no, without, nothing with, avoid, skip the, anything but | `not from Ridgeline` |
| stated attributes | surface forms the catalog knows | `waterproof` → water resistant, `gym` → athletic |
| filler | "I'm looking for", "please" | dropped |

Order is what makes it work. `not over $50` is a budget before anything can read
it as a refusal of "over"; `no-show` is a name before `no` is a refusal.

A refusal applies at two levels: the recorded value is excluded, and the refused
word is banned from titles — which is what makes `not from Ridgeline` work with
no brand vocabulary at all.

## Measured

### On the real catalog

`npm run bench` on the shipped 9,901 real products; the same 800 sentences
through a keyword matcher for comparison.

|  | keyword matcher | sentence parser | parser, held-out |
|---|---|---|---|
| Hit@10 | 0.04 | **0.34 ± 0.01** | 0.34 ± 0.03 |
| Hit@1 | 0.004 | **0.07 ± 0.01** | 0.07 ± 0.01 |
| MRR | 0.02 | **0.15 ± 0.01** | 0.16 ± 0.01 |
| refusals inverted into requirements | 597 | **0** | 0 |
| refused value shown in top 10 | 368 | **0** | 0 |
| budget broken in top 10 | 22 | **0** | 0 |
| wrongly filtered out | — | **0.6%** | 3.1% |

Real data changed three things, and none of them was the policy.

**The noun is a category, not a title word.** On the synthetic catalog a belt's
title says "Belt". Half of real titles do not name their category — *Columbia
Men's Thistletown Park Crew* is a T-shirt. Requiring the shopper's noun in the
title dropped the right product in **47%** of cases. The category tree is now a
facet: every node on a product's path is a value, so "shoes" matches all shoes
and "running" the running ones, and the noun the shopper says is looked up in
it. That one change took wrongly-filtered from 47% to 4.6%; two smaller ones —
a value counts wherever the record carries it, and stray words rank rather than
filter once the noun is understood — took it to 0.9%.

**The category is askable, one level at a time.** `shoes` → *athletic, fashion
sneakers, loafers & slip-ons, oxfords* → *running, team sports, walking* →
*casual, outdoor* → 58 candidates. A hierarchy is not settled by one answer, so
it is the one facet that can be asked again; ancestors the whole pool shares are
never offered; depth is measured per product relative to what the shopper named,
because the same node sits at different positions in different paths.

The leaf-level benchmark cannot see any of this: its sentences start at the
product's own category. `npm run broad` starts 600 sessions at "shoes" or
"clothing" instead and lets the store ask its way down, then runs the same
sessions with category asking switched off:

| | Hit@10 ± se | MRR | questions | final pool |
|---|---|---|---|---|
| category asked | **0.31 ± 0.02** | 0.15 | 1.85 | **121** |
| category never asked | 0.16 ± 0.02 | 0.07 | 1.34 | 597 |

Paired on identical shards: Δ Hit@10 +0.148 ± 0.048, 8/8, t 8.8; Δ pool −476,
0/8; Δ questions +0.51, 8/8. Walking the tree doubles the hit rate and cuts the
pool by four fifths, for half a question more. This is the largest single
effect measured in this repo, and it was invisible until the benchmark started
where shoppers start.

**Coverage is the ceiling.** Material is recorded on 56% of real products,
closure on 31%, occasion on 25%, fit on 8%; a fifth carry a price. The mean
pool after the conversation is around **500**, and lowering the ask threshold
to zero barely moves it. On this catalog the store's questions are limited by
what the listings record, not by the policy — which is what "missing is not a
mismatch" was for, and why `leather belt` answers with 64 candidates here
exactly as the original implementation's README says it should.

**Titles are read at build time.** The extractor read structured fields; titles
say more — *Slip-on Sandal*, *Waterproof Hiking Boots*, *Genuine Leather*. The
engine already treats a title saying a value as that value, so
`catalog_real.mjs` makes it explicit: every surface form in the vocabulary is
matched against every title (longest first, negations like *faux leather*
skipped, category never touched) and recorded. It adds material to 503
products, occasion to 465, closure to 388, fit to 208 — coverage up three to
four points per facet, mean pool 498 → 454, Hit@10 0.320 → 0.335. Modest,
because the extractor had already read titles for sleeve and waterproof; what
is left uncaptured lives in descriptions this data does not carry. That is the
coverage ceiling for this catalog. `--no-backfill` rebuilds without it.

### The benchmark, on the synthetic catalog

The controlled catalog every experiment below was first run on: 1,204 products
whose attributes are multi-valued and unevenly recorded on purpose. `npm run
catalog:synthetic` rebuilds it. 800 sentences generated from product records,
answered truthfully; `--holdout` re-runs the same targets under phrasings the
parser was never tuned on.

|  | keyword matcher | sentence parser | parser, held-out |
|---|---|---|---|
| Hit@10 | 0.17 | **0.69 ± 0.03** | 0.71 ± 0.02 |
| Hit@1 | 0.03 | **0.11 ± 0.01** | 0.13 ± 0.01 |
| MRR | 0.08 | **0.28 ± 0.01** | 0.29 ± 0.01 |
| refusals inverted into requirements | 607 | **0** | 0 |
| refused value shown in top 10 | 166 | **0** | 0 |
| budget broken in top 10 | 223 | **0** | 0 |
| re-asked after "no preference" | — | **0** | 0 |
| turns | — | 1.63 | 2.11 |

The listening checks are the claim. The retrieval numbers need a caveat: after
the dialogue the mean pool is 21 products, and if order inside that pool were a
coin flip Hit@10 would already be 0.617. The parser reaches 0.685. Ranking does
real but modest work, because once every candidate satisfies every stated
attribute there is genuinely little left to separate them — which is the whole
reason this store asks a question instead of pretending to rank.

**The store wrongly filters out the product the shopper meant in 0.0% of
cases on the synthetic catalog and 0.9% on the real one.** That number, not
Hit@10, is what a change to the parser should be judged on.

### The fuzzer

`node scripts/fuzz.mjs [seed]` builds sentences out of fragments from every pass
— negators, money in eleven shapes, waivers, brands, punctuation, `$$40`,
`$-5`, uppercase, tripled text — and checks the whole pipeline, not just the
parse: that it terminates, that the budget is never inverted or NaN, that no
single character is banned, that a question is never asked with fewer than
twelve candidates or with an option nothing matches, that the same facet is
never asked twice, and that **answering never widens the pool**.

Every case is written to a scratch file before it runs, so a hang leaves the
offending sentence on disk rather than an empty terminal.

That last invariant caught a real one. The title-term filter fell back to no
filtering when fewer than four products matched all the terms. Answering a
question shrinks the pool, which could drop the strict set below four, which
dropped the filter — and the shopper watched the results *grow* because they had
answered. Adding a constraint was quietly relaxing another. The reading is now
decided once and frozen: how the store read your words does not change because
you answered a question.

6,000 sentences across four seeds now run clean.

### The spread

`npm run shards` cuts the 800 sentences into 8 shards of 100 and scores each,
so every figure above carries the spread the digits have to survive. The
tables quote mean ± standard error over shards. Third decimals appear
elsewhere in this README only where a table is reproducing a script's raw
output; they are not claims.

|  | synthetic, tuned | synthetic, held-out | real, tuned | real, held-out |
|---|---|---|---|---|
| Hit@10, sd across shards | 0.071 | 0.056 | 0.024 | **0.070** |
| Hit@10, shard range | 0.56–0.78 | 0.63–0.79 | 0.29–0.36 | **0.24–0.46** |

Two consequences. Held-out spreads are two to three times the tuned ones on the
real catalog, so "held-out scores higher than tuned" — which an earlier draft
of this README said — is not a statement the data supports; the two are
indistinguishable. And the earlier lookahead / frontier deltas of −0.006 to
+0.002 sit far inside these spreads, which is what "same curve" means in
numbers.

The same script runs the two contested comparisons **paired on identical
shards**, where the delta's own spread decides:

| A vs B (same shards) | Δ Hit@10 | B wins | t | Δ questions asked | B wins |
|---|---|---|---|---|---|
| myopic vs sequential, synthetic | +0.035 ± 0.021 | 8/8 | 4.6 | +0.18 ± 0.03 | 8/8 |
| myopic vs sequential, real | +0.026 ± 0.030 | 5/8 | 2.5 | +0.55 ± 0.05 | 8/8 |
| cost 10 vs cost 5, synthetic | +0.070 ± 0.028 | 8/8 | 7.0 | +0.35 ± 0.06 | 8/8 |
| cost 10 vs cost 5, real | +0.018 ± 0.014 | 6/8 | 3.6 | +0.12 ± 0.04 | 8/8 |

So the raw gains are real — sequential wins on every synthetic shard — and so
is what buys them: more questions, on every shard, by a wider margin. The
paired test confirms both halves of the trade at once. Which is why the
comparison that decides is the frontier at equal questions asked, and there
the difference is noise. Nothing in this table changes what ships.

### The parser cases

`node scripts/parse_test.mjs` — 72 hand-written sentences, each pinning both
halves of the job: what must be read, and what must be left alone. *no-show
socks* refuses nothing, *size 10* is not a budget, *41mm* is not $41, *nothing
over $200* is a ceiling and not a floor, *no wool and no acrylic* is two
refusals and not one.

A benchmark generated from templates can pass while the next phrasing a person
tries fails. These are the phrasings. Writing them found four real defects: a
refusal loop that spun forever on `not too expensive`, a greedy capture that
swallowed the second refusal in `no wool and no acrylic`, contractions that were
invisible, and negated floors read as floors.

### What the ranking weights are worth

`npm run weights` knocks out one weight at a time. Every experiment in this
section runs on the same sentences as the benchmark (`scripts/lib/sessions.mjs`);
an earlier draft of this README quoted numbers from a second generator that had
drifted, which is why some of these differ from what was here before.

| weight set to zero | Hit@10 | Δ |
|---|---|---|
| baseline | 0.648 | |
| `unpricedUnderBudget` | 0.602 | −0.046 |
| `attrMatch` | 0.634 | −0.014 |
| `term` | 0.648 | 0.000 |
| `attrUnrecorded` | 0.648 | 0.000 |
| `attrInTitle` | 0.658 | +0.010 |
| `rating` | 0.670 | +0.022 |
| `demand` | 0.684 | +0.036 |

Only pushing unpriced products down under a stated budget clearly earns its
keep. The title-term weight measures at **exactly** zero, because terms are
already applied as a filter during retrieval — every survivor scores the same on
it, so it can never break a tie.

`demand` and `rating` measure as *costing* accuracy, and they are left in
anyway. The benchmark draws its target uniformly from the catalog, so the
product the shopper "meant" is, by construction, usually not a popular one, and
any weight that favours popular products is penalised for it. Real shoppers are
not uniform over the catalog. This is the benchmark's blind spot, and the same
rule applies as everywhere else here: a metric that cannot see one side of a
trade is not the thing to tune against.

### What a question is worth

`npm run askvalue` runs the same sentences under different question budgets.

| question budget | Hit@10 | final pool | questions asked |
|---|---|---|---|
| 0 (never ask) | 0.507 | 32.8 | 0.00 |
| 1 | 0.645 | 22.3 | 0.57 |
| 2 | 0.655 | 21.6 | 0.65 |
| 3 (shipped) | 0.655 | 21.6 | 0.66 |

The first question is worth +0.138. The second is worth +0.010. The third is
worth nothing — the budget of three is a guardrail that never fires on this
data, and so is the "stop at 12 candidates" rule. Both are honest about being
untested rather than tuned.

The knob that actually decides is how hard a question must work to earn its
turn:

| `minRemoved` | Hit@10 | questions asked |
|---|---|---|
| 0 | 0.737 | 1.06 |
| 5 | 0.730 | 0.99 |
| 10 (shipped) | 0.655 | 0.66 |
| 25 | 0.533 | 0.16 |

Lowering it to 5 buys +0.075 Hit@10 for 0.33 more questions per search, and the
benchmark says take it. **It is not taken.** The simulated shopper answers
instantly, truthfully, and never gets tired, so this benchmark can price the
benefit of asking and cannot price the cost. Tuning against a metric that sees
one side of a trade is how a store ends up interrogating people. The frontier is
published here so the choice is visible instead of buried in a constant.

### Two-step lookahead, measured and rejected

The shipped policy is myopic: it asks about the single attribute expected to
remove the most candidates. A natural upgrade is two-step lookahead — pick the
attribute whose expected removal *plus the best follow-up question* is largest.
It was built on a scratch copy and measured before touching the shipped code.

| | Hit@10 | Hit@1 | turns | final pool |
|---|---|---|---|---|
| myopic (shipped) | 0.713 | 0.107 | 1.59 | 20.8 |
| two-step lookahead | 0.673 | 0.095 | 1.42 | 24.2 |

It is worse, asks *fewer* questions, and on `running shoes` does not ask at all.

So the fix was built: a sequential policy (`P.mode = "sequential"`) that chooses
and stops from one value function — the best expected clearance over the remaining
question budget, net of a fixed cost per question. Selection and stopping can no
longer disagree. `npm run sequential` measures it:

| policy | Hit@10 | turns | questions asked | final pool |
|---|---|---|---|---|
| myopic (shipped) | 0.655 | 1.66 | 0.66 | 21.6 |
| sequential | 0.698 | 1.86 | 0.86 | 19.8 |

Better on Hit@10 — and asking 0.20 more questions per search. Which raises the
question that decides it: is the curve higher, or did the policy just move along
the same curve? `npm run frontier` sweeps the per-question cost for both and
compares them **at equal questions asked**:

| questions asked | myopic | sequential | Δ |
|---|---|---|---|
| 0.4 | 0.584 | 0.575 | −0.008 |
| 0.6 | 0.632 | 0.627 | −0.004 |
| 0.8 | 0.688 | 0.679 | −0.009 |
| 1.0 | 0.721 | 0.722 | +0.001 |

Same curve. On this catalog the myopic first question is almost always the right
first question — material dominates — so there is nothing for planning to buy.
The naive-lookahead loss was a formulation bug, not evidence that planning helps;
the correct formulation is no better here, and no worse. It stays available and
off. On a catalog where the best first question depends on the second, it is the
one to turn on.
The reason is structural rather than a tuning problem: lookahead chooses an
attribute by its two-step score, but the "is this question worth a turn"
threshold still judges that attribute by its one-step score. Choose an attribute
that only pays off in two steps and the threshold refuses it. Selection and
stopping have to use the same quantity, which means a proper sequential
formulation — a small dynamic programme over the remaining question budget with
the stopping rule inside the recursion — rather than greedy lookahead bolted onto
a per-step threshold. With five facets and a budget of three that is cheap. It is
also not a change to make in the hours before a deadline.

### What the threshold believes about patience

The benchmark's shopper never leaves, so it cannot price a question. `npm run
patience` makes the price an explicit assumption instead: with a per-question
hazard *h* — the chance a shopper walks away each time they are asked — the
expected hit is Σ (1−h)^asked × hit over sessions, and for each *h* there is a
threshold that maximises it.

| if a shopper walks away with probability… | the right cost is | asking |
|---|---|---|
| h = 0 (never) | 3 | 1.05 questions |
| h = 0.10 | 3 | 1.05 |
| h = 0.15 | 5 | 0.99 |
| h = 0.20 | 5 | 0.99 |
| h = 0.30 | 14 | 0.45 |

The shipped cost of 10 is within one standard error of the best only for *h*
between 0.19 and 0.38. In other words, **the default quietly assumes that
roughly one shopper in four walks away every time the store asks a question.**
That may be right; it may be far too pessimistic. The point is that it is now
a stated belief rather than a constant, and whoever runs this store on a real
catalog can replace it with a measured one.

## The stopping policy

`decide()` answers when any of these hold:

- **≤ 12 candidates** — the shopper can just look.
- **3 questions already asked** — the budget is spent.
- **No remaining question earns its turn** — the best one clears fewer than 10
  candidates, or less than 18% of the pool.

Otherwise it asks about the attribute expected to remove the most candidates,
skipping anything the shopper stated or waved through.

Three things this got wrong first:

**Entropy is the textbook choice and it is wrong for this data.** A product
carries several values of one attribute at once — a shoe is both athletic and
casual — so the value shares are not a probability distribution and `-Σp·log p`
is meaningless. Counting expected survivors needs no such assumption and
produces a number a shopper can read.

**Missing is not a mismatch — in both directions.** Only 6% of this catalog
records a `fit`, and a naive gain calculation adores `fit` because asking it
"removes 94% of candidates" — for having no data. So reduction is measured
inside the covered subset, and any attribute recorded on under 45% of the pool
is never asked about. The same asymmetry bites on the way in: requiring the
recorded value dropped the right product in 6.5% of benchmark cases, because a
boot titled *Hiking Boot* whose record forgot the tag is not a mismatch. A
requirement is now met by the recorded value **or** by the title saying so. That
one change took wrongly-filtered from 6.5% to 0.9%.

**A question has to earn its turn in absolute terms.** Cutting 409 candidates to
213 is worth a turn; cutting 23 to 9 is not, yet the second is the larger
fraction.

## The tools

| Tool | What it does |
|---|---|
| `search_products` | The request in the shopper's words, plus anything already known, structured. Returns products **or** a question. |
| `answer_question` | *Registered only while a question is open.* Option values, or `no_preference` — which is remembered. |
| `parse_only` | *Dry run.* How the store would read a sentence — requirement, refusal, budget, ordering, change of mind, what it ignores — without searching. *read-only* |
| `refine_search` | Add one requirement or one refusal. |
| `revise_search` | *The shopper changed their mind.* Drop one thing they said and keep the rest, or `drop_all` to start the request over. Reports what it dropped. |
| `list_attributes` | The vocabulary this catalog carries, with counts. *read-only* |
| `show_products` | Replace the grid with ids the agent picked, in its order. |
| `explain_ranking` | Which words matched, which attributes were unrecorded, demand signal, question budget left. *read-only* |
| `add_to_cart` · `remove_from_cart` · `view_cart` | The cart, with line totals. |
| `reset_search` | Clear the search including the question budget. The cart is kept. |
| `checkout` | Declarative: a `<form toolname="checkout">` with no `toolautosubmit`. An agent can fill it; only the person presses it. |

**The tool list is state.** `answer_question` is registered with a fresh
`AbortController` while a question is open and removed by aborting that signal —
the spec's own way to unregister. An agent reading the tool list can see what
the page is waiting for without being told. `node scripts/tools_test.mjs`
asserts it appears, disappears, fires `toolchange` both ways, and cannot be
called out of turn.

**Catalog text is data, never instruction.** A product title is third-party text
and may say anything. A hostile product is inserted during the tool tests and the
suite asserts its title appears only inside product records — `products[]`,
`candidate_sample[]`, `explain_ranking.title`, cart lines — and never in
`question`, `why`, `note`, `options`, `differentiators` or `relax`, the fields an
agent reads as the store speaking. The boundary was already true; now it cannot
be broken by a rewording.

**An open question survives a navigation.** WebMCP tools are registered per
page; without help, a refresh loses the question and the tool that answers it.
The reading, the answers and the cart are kept in `sessionStorage` (products
are never stored — they are recomputed) and rebuilt on load, `answer_question`
re-registered with them. `?fresh=1` starts clean; an hour-old session is
ignored. `scripts/persist_test.mjs` boots two pages on one session and checks
the second is holding the first's question.

**One code path, two surfaces.** A person clicking an option chip and an agent
calling `answer_question` enter the same function, so the page cannot drift
between what it shows a human and what it tells an agent.

**The agent's knowledge wins.** Anything passed structured — attributes,
exclusions, budget, facets the shopper does not mind — overrides the parse, and
the store never asks about it.

The page reads `document.modelContext` first and the deprecated
`navigator.modelContext` alias second, so a browser on either side of the May
2026 rename is live. Registration is defensive: a native implementation may throw
on a duplicate name, may honour the `AbortSignal`, or may only expose
`unregisterTool`, and `scripts/native_test.mjs` drives the page against all
three shapes. The API is `[SecureContext]`, so a deployed page must be HTTPS.

If the browser has no WebMCP, a spec-shaped stand-in (`registerTool` with an
`AbortSignal`, `getTools`, `toolchange`) takes over and the same registration
code runs unchanged. The header badge says which mode you are in.

## Changing your mind

A shopping conversation is not a form. People take things back, and they do it in
the middle of a sentence: *"actually, ignore my earlier preference — what I need is
nylon"*, *"scratch that"*, *"a nylon belt instead of leather"*, *"forget everything,
show me hiking boots"*.

Before this existed the store did something worse than ignore it: `scratch`, `mind`,
`forget` and `everything` fell through to the title matcher and were used to **match
products by name**. The retraction pass claims those spans before anything else can
read them.

Two kinds are distinguished because they behave differently:

- **A scoped change** drops what it names, plus anything the agent is still holding on
  a facet the shopper has just restated, and keeps the rest. The budget survives a
  change of material.
- **A reset** drops everything carried in and hands back the question budget, because
  it is a new conversation. The cart is kept either way.

Whatever is dropped comes back as `superseded` in the tool result and as a struck-through
chip on the page, so neither the agent nor the person has to guess whether the store
heard the change. `revise_search` lets an agent do the same thing explicitly when the
shopper's words did not carry it.

`a wallet I won't forget` is not a retraction, and there is a test that says so.

## When nothing survives

Three requirements and a budget can empty a catalog, and "no results" is the
least useful thing a store can say. When fewer than four products survive, the
store lifts each requirement, refusal, banned word and the budget in turn,
re-counts, and reports which one is doing the damage — as `relax` to the agent,
as buttons to the person.

## What it does across a spread of queries

`npm run eval`, 49 queries:

    asks a question first        41 (84%)
    mean turns to an answer      2.08
    mean final candidates        20.1
    what it asks about           material 27, what it's for 14
    102 retrievals in 143 ms  —  1.40 ms each

## What's next

`ROADMAP.md` — what is done, what was measured and kept off, and what is left,
each tied to the judging criterion it serves and sized honestly.

## Submitting this

`SUBMISSION.md` is the Devpost text, `DEMO_SCRIPT.md` is the video shot list with
every on-screen number checked against the running app, and `CHECKLIST.md` is what
is already verified versus what still needs a human.

## Architecture

Classic scripts, no bundler, no framework; the single file is the same scripts
concatenated. Two rules hold it together.

**The engine is parts with explicit dependencies.** `vocabulary` is pure data.
`parser(vocabulary, brands)` reads a sentence. `retrieval(catalog, vocabulary)`
filters and ranks over a reading. `policy(vocabulary, retrieval)` decides whether
to answer or ask. `engine.js` composes them and exposes the one entry point both
surfaces use. Nothing reaches sideways: the parser cannot see the catalog, the
policy cannot see a sentence.

**The parser is a pipeline, and order is data.** Thirteen named passes run top to
bottom; each takes what it claims through one function that blanks the span and
writes a line of the trace. `parse_only` returns that trace — which word was read
by which pass as what — so a reading can be audited instead of trusted. The
order is pinned by a test, so reordering the passes is a failing test rather
than a surprise in a benchmark.

**The app is a namespace, and the tool surface is a table.** `app/core.js` owns
state, the shared entry points and persistence; `app/tools.js` is one row per
tool — name, description, schema, read-only flag, handler — and the loop that
registers them; `app/render.js` draws; `app/agent.js` is the scripted demo;
`app.js` boots. A person clicking a chip and an agent calling a tool reach the
same function in `core`.

**Every benchmark uses one session generator.** `scripts/lib/sessions.mjs`
builds the cases, runs the conversation and scores it; `scripts/lib/boot.mjs`
boots the page headlessly. Before these existed, seven scripts carried their own
copy of the generator and two had drifted, so two tables in this README were
measured on different sentences without saying so.

Splitting the engine and the app changed no number: the benchmark, the
evaluation and the smoke output were captured before and diffed after, and 55
lines of figures match to the digit.

## Layout

    counterask-demo.html      the whole thing in one file, real catalog, 2.9 MB
    counterask-demo-lite.html the same on the synthetic catalog, 107 KB
    public/
      index.html              the page
      catalog.js              the shipped catalog: 9,901 real products, plus its vocabulary
      engine.js               composes the parts; search / answer / finish
      engine/
        vocabulary.js         surface forms and patterns — pure data
        parser.js             the twelve-pass pipeline and its trace
        retrieval.js          filter and rank over a reading
        policy.js             evidence, the stopping policy, the sequential variant
      app.js                  boot
      app/
        core.js               state, shared entry points, persistence, WebMCP binding
        tools.js              the tool surface as a table; answer_question's lifecycle
        render.js             drawing
        agent.js              the scripted demo
    scripts/
      lib/sessions.mjs        the one session generator every benchmark uses
      lib/boot.mjs            headless page boot shared by every page test
      lib/synthetic.js        the deterministic synthetic generator
      catalog_real.mjs        build catalog.js from a real catalog.json; category tree becomes a facet
      catalog_synthetic.mjs   build catalog.js from the generator
      build.mjs               inlines every script into the single file
      bench.mjs               800 generated sentences; --holdout for unseen phrasings
      parse_test.mjs          72 hand-written sentences the parser must and must not over-read
      tools_test.mjs          the WebMCP surface against a stand-in modelContext
      native_test.mjs         live mode against three spec-shaped native implementations
      uitest.mjs              the page, headless
      singletest.mjs          the bundled single file, headless
      eval.mjs                ask rate, pool sizes, timing
      weights.mjs             ranking weight sensitivity
      askvalue.mjs            what each question is worth
      lookahead.mjs           two-step lookahead, built on a scratch copy and rejected
      sequential.mjs          the correctly formulated sequential policy vs myopic
      frontier.mjs            both policies at equal questions asked
      patience.mjs            the per-question hazard each threshold implies
      shards.mjs              every figure's spread over 8 shards; paired comparisons
      broad.mjs               sessions that start at "shoes"; the category question's value
      persist_test.mjs        an open question survives a navigation
      fuzz.mjs                adversarial sentences; checks invariants, not output
      smoke.mjs               how the sample queries are read and decided
    SUBMISSION.md · DEMO_SCRIPT.md · CHECKLIST.md   submission material
    .github/workflows/pages.yml   runs npm test, publishes public/ to Pages
    netlify.toml · vercel.json

## Known limits

The simulated shopper answers instantly and only states attributes the target
really has, so no benchmark here can price a person's patience or a wrong
answer. That is why the ask threshold is set in absolute candidates removed
rather than fitted to this data, and why the `minRemoved` frontier above is
published rather than optimised.

The catalog is synthetic. Products within a family are deliberately similar,
which makes tie-breaking harder than a real catalog would — good for
demonstrating why the store asks, pessimistic for the ranking numbers.

MIT.
