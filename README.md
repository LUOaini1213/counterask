# Counterask — a store that asks back

A menswear storefront whose WebMCP tools return **a question** when answering
would be a guess. No server, no model call, no tokens: the whole store is one
page.

An independent implementation of the idea, not a copy of anyone's code. The
catalog is synthetic and generated deterministically, so every run is identical
and the demo works offline.

## Open it

- `counterask-demo.html` — one self-contained file, 76 KB. Double-click it.
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

### The benchmark

`npm run bench` — 800 sentences generated from real product records, answered
truthfully. `--holdout` re-runs the same 800 targets under phrasings the parser
was never tuned on.

|  | keyword matcher | sentence parser | parser, held-out |
|---|---|---|---|
| Hit@10 | 0.166 | **0.677** | 0.704 |
| Hit@1 | 0.030 | **0.104** | 0.129 |
| MRR | 0.082 | **0.273** | 0.286 |
| refusals inverted into requirements | 607 | **0** | 0 |
| refused value shown in top 10 | 166 | **0** | 0 |
| budget broken in top 10 | 223 | **0** | 0 |
| re-asked after "no preference" | — | **0** | 0 |
| turns | — | 1.64 | 1.63 |

The listening checks are the claim. The retrieval numbers need a caveat: after
the dialogue the mean pool is 21 products, and if order inside that pool were a
coin flip Hit@10 would already be 0.604. The parser reaches 0.677. Ranking does
real but modest work, because once every candidate satisfies every stated
attribute there is genuinely little left to separate them — which is the whole
reason this store asks a question instead of pretending to rank.

**The store wrongly filters out the product the shopper meant in 0.9% of
cases.** That number, not Hit@10, is what a change to the parser should be
judged on.

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

`npm run weights` knocks out one weight at a time.

| weight set to zero | Hit@10 | Δ |
|---|---|---|
| baseline | 0.712 | |
| `unpricedUnderBudget` | 0.658 | −0.054 |
| `demand` | 0.684 | −0.028 |
| `attrInTitle` | 0.706 | −0.006 |
| `attrMatch` | 0.708 | −0.004 |
| `rating` | 0.708 | −0.004 |
| `attrUnrecorded` | 0.718 | +0.006 |
| `term` | 0.712 | 0.000 |

Only pushing unpriced products down under a stated budget clearly earns its
keep. The title-term weight measures at **exactly** zero, because terms are
already applied as a filter during retrieval — every survivor scores the same on
it, so it can never break a tie. Sweeping `demand` from 0 to 1.0 moves Hit@10
between 0.684 and 0.720 with no trend. The ranking is on a plateau; the weights
are left where they are rather than fitted to noise.

### What a question is worth

`npm run askvalue` runs the same sentences under different question budgets.

| question budget | Hit@10 | final pool | questions asked |
|---|---|---|---|
| 0 (never ask) | 0.560 | 31.5 | 0.00 |
| 1 | 0.697 | 21.5 | 0.54 |
| 2 | 0.713 | 20.8 | 0.59 |
| 3 (shipped) | 0.713 | 20.8 | 0.59 |

The first question is worth +0.137. The second is worth +0.016. The third is
worth nothing — the budget of three is a guardrail that never fires on this
data, and so is the "stop at 12 candidates" rule. Both are honest about being
untested rather than tuned.

The knob that actually decides is how hard a question must work to earn its
turn:

| `minRemoved` | Hit@10 | questions asked |
|---|---|---|
| 0 | 0.788 | 1.06 |
| 5 | 0.778 | 0.97 |
| 10 (shipped) | 0.713 | 0.59 |
| 25 | 0.600 | 0.15 |

Lowering it to 5 buys +0.065 Hit@10 for 0.4 more questions per search, and the
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
The reason is structural rather than a tuning problem: lookahead chooses an
attribute by its two-step score, but the "is this question worth a turn"
threshold still judges that attribute by its one-step score. Choose an attribute
that only pays off in two steps and the threshold refuses it. Selection and
stopping have to use the same quantity, which means a proper sequential
formulation — a small dynamic programme over the remaining question budget with
the stopping rule inside the recursion — rather than greedy lookahead bolted onto
a per-step threshold. With five facets and a budget of three that is cheap. It is
also not a change to make in the hours before a deadline.

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

## Submitting this

`SUBMISSION.md` is the Devpost text, `DEMO_SCRIPT.md` is the video shot list with
every on-screen number checked against the running app, and `CHECKLIST.md` is what
is already verified versus what still needs a human.

## Layout

    counterask-demo.html      the whole thing in one file, 76 KB (20 KB gzipped)
    public/
      index.html              the page
      catalog.js              deterministic synthetic catalog, 1,204 products
      engine.js               parser, retrieval, attribute evidence, stopping policy
      app.js                  state machine, rendering, tool registration, scripted agent
    scripts/
      build.mjs               inlines the three scripts into the single file
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
