# Devpost submission text

Paste the sections below into the matching Devpost fields. Everything here is
checkable against the repository; no claim appears that a test does not cover.

---

## Tagline (one line)

A storefront whose WebMCP tools hand the agent a question instead of a guess.

---

## Inspiration

Every WebMCP storefront exposes the same shape of tool: `get-products`,
`filter-products`, `show-products`. The spec's own e-commerce example does exactly
that. All of them share one assumption — that the store's job is to **answer**.

For most of a shopping conversation that assumption is wrong. Ask this catalog for
"a belt" and 96 products match. Every one of them is a belt. The top-ranked item
beats the tenth by a rounding error. Ranking them is a coin flip dressed up as a
recommendation.

The store knows this. It has the distribution in front of it — it can see that one
more fact, what the belt is made of, would clear about fifty of them. But a tool
that can only return products has no way to say so. So it returns its coin flip,
and the agent presents a guess as an answer.

We gave the store a second move.

## What it does

`search_products` returns one of two things.

When there is enough evidence, it answers — and says what still separates the
products it is showing, so the agent can summarise ("eleven buckle, one pull-on")
instead of reading out a list.

When answering would be a guess, it returns `status: "need_more_evidence"` with
the one question worth asking, the options with their counts, and why:

> 96 candidates, leader only 5% ahead.
> Asking "material" clears ~50 of them on average (recorded on 90%).

The question is not a failure path. It is the store declining to guess on the
shopper's behalf.

Three things follow from that shape:

**The tool list is state.** `answer_question` is registered only while a question
is open, and removed by aborting the `AbortSignal` it was registered with — the
spec's own way to unregister. An agent reading the available tools can see what
the page is waiting for without being told.

**One code path, two surfaces.** A person clicking an option chip and an agent
calling `answer_question` enter the same function. The page cannot drift between
what it shows a human and what it tells an agent. Hovering an option dims the
products that answer would eliminate, and the count updates live — the person sees
the same evidence the policy used.

**The last press is the person's.** Checkout is a declarative
`<form toolname="checkout">` with no `toolautosubmit`. An agent can fill it in.
Only the person can submit it.

## How we built it

No server, no model call, no tokens. The whole store is one page: a 1,204-product
catalog, a sentence parser, a retrieval index and the stopping policy, in 86 KB
(21 KB gzipped). It runs offline.

**Reading a sentence, not a search box.** A search box gets `leather belt`. An
agent relaying a person gets *"I'm looking for a leather belt, nothing with a snap,
not over $50"*. Fed to a keyword matcher that goes wrong three ways at once: it
requires "looking" and "over" to appear in a title, it reads "snap" as a
requirement rather than a refusal, and it never sees the budget at all.

The parser runs in a fixed order and blanks every span it claims, so a word read
one way is never read again another way. `not over $50` is a budget before
anything can read it as a refusal of "over". `no-show` is a product name before
`no` is a refusal. `scratch that` is a change of mind before `scratch` becomes a
word to match product titles against.

**The stopping policy.** For each attribute the store counts the expected number
of candidates a question would remove, and asks about the best one — unless the
best one clears fewer than 10 candidates or under 18% of the pool, in which case
it answers and says why the question was not worth a turn.

Entropy is the textbook choice here and it is wrong for this data: a product
carries several values of one attribute at once (a shoe is both athletic and
casual), so the value shares are not a probability distribution and `-Σp·log p`
is meaningless. Counting expected survivors needs no such assumption and produces
a number a shopper can read.

**Changing your mind.** People take things back mid-sentence. A scoped change
("scratch that", "a nylon belt instead of leather") drops what it names and keeps
the budget; a reset ("forget everything") drops everything and hands back the
question budget. Whatever is dropped comes back as `superseded` and appears as a
struck-through chip, so neither the agent nor the person has to guess whether the
store heard the change.

## Challenges we ran into

**Missing is not a mismatch — in both directions.** Only 6% of this catalog
records a `fit`, and a naive gain calculation adores `fit` because asking it
"removes 94% of candidates" — for having no data. So reduction is measured inside
the covered subset, and any attribute recorded on under 45% of the pool is never
asked about.

The same asymmetry bit on the way in. Requiring the recorded value threw away the
product the shopper meant in 6.5% of benchmark cases, because a boot titled
*Hiking Boot* whose record forgot the tag is not a mismatch. A requirement is now
met by the recorded value **or** by the title saying so. That one change took
wrongly-filtered from 6.5% to 0.9%.

**A fuzzer caught the bug we would never have found by hand.** One invariant it
checks is that answering a question must never widen the pool. It failed. The
title-term filter fell back to no filtering when fewer than four products matched
all the terms; answering a question shrinks the pool, which could drop the strict
set below four, which dropped the filter — and the shopper watched the results
*grow* because they had answered. Adding a constraint was quietly relaxing another
one. The reading is now decided once and frozen.

**We measured what a question is worth, then refused to act on it.** The first
question buys +0.137 Hit@10; the second +0.016; the third nothing. Lowering the
"is this question worth a turn" threshold from 10 to 5 buys another +0.065 for 0.4
extra questions per search, and the benchmark says take it. We did not take it.
The simulated shopper answers instantly, truthfully, and never gets tired — the
benchmark can price the benefit of asking and cannot price the cost. Tuning
against a metric that sees one side of a trade is how a store ends up
interrogating people. The whole frontier is published in the README instead of
being buried in a constant.

## Accomplishments we're proud of

Measured on 800 sentences generated from real product records, against a keyword
matcher on the identical sentences:

| | keyword matcher | this store |
|---|---|---|
| refusals inverted into requirements | 607 | **0** |
| refused value shown in top 10 | 166 | **0** |
| budget broken in top 10 | 223 | **0** |
| Hit@10 | 0.166 | **0.677** |

Held-out phrasings the parser was never tuned on score 0.704 with the same zero
failures.

We are equally proud of the caveat we attached to it: after the dialogue the mean
pool is 21 products, and if order inside that pool were a coin flip Hit@10 would
already be 0.604. Ranking does real but modest work — because once every candidate
satisfies every stated attribute, there is genuinely little left to separate them.
That is the whole reason this store asks a question instead of pretending to rank.

`npm test` runs 80 hand-written parser cases, 4,000 fuzzed sentences, 81 assertions
against the WebMCP surface, 36 against the page, the bundled single file, and both
benchmarks.

## What we learned

The spec lists **fully autonomous workflows** under Non-Goals, and says the human
web interface remains primary with agent tools augmenting rather than replacing
user interaction. A tool that returns a question is the most direct expression of
that intent we could build. It puts the person back in the loop at the exact
moment the machine cannot decide — not as a permission prompt bolted on
afterwards, but because the site genuinely does not know and says so.

## What's next

Real catalogs with real attribute coverage; a shopper study that can price the
cost of a question, which is the one number our benchmarks cannot see; and
carrying an unanswered question across a page navigation.

## Built with

JavaScript, HTML, CSS, WebMCP (`document.modelContext`), Node, jsdom. No server,
no framework, no model, no API key.

## Try it

- Live: *(your Pages / Netlify / Vercel URL)*
- `?agent=demo` runs a scripted agent through the whole flow with no setup.
- In ChatGPT's in-app browser, or Chrome with
  `chrome://flags/#enable-webmcp-testing`, real tools are registered — the badge
  in the header tells you which mode you are in. Without WebMCP the page degrades
  to an ordinary, fully working search UI that understands the same sentences.
