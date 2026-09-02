# Devpost submission text — Counterask

Paste-ready. The four headed sections are the four things the challenge asks
the description to explain, in the order it asks for them.

---

**Project name:** Counterask

**Elevator pitch (≤ 200 chars):**
A storefront whose WebMCP tools return a *question* when answering would be a
guess — and that reads a whole sentence the way an agent relays it: budget,
refusals and all.

**Built with (tags):** webmcp, javascript, html, css, bm25, python, amazon-reviews-2023, no-backend

---

## Why this use case is a strong fit for WebMCP

Every storefront in this challenge will expose the same shape of tool:
`get-products`, `filter-products`, `show-products`. The WebMCP spec's own
e-commerce example does exactly that. All of them assume the store's job is to
**answer**.

For most of a shopping conversation that assumption is wrong. Ask this catalog
for "a belt" and 97 products match; the top-ranked one beats the tenth by 5%.
Ranking them is a coin flip dressed as a recommendation. One more fact — what
it is made of — clears forty of them on average. The store *knows* this; it
has the distribution in front of it. But a tool that can only return products
has no way to say so, so it returns its coin flip and lets the agent present a
guess as an answer.

WebMCP is the first place a website can express its own uncertainty as a
first-class outcome. `search_products` returns one of two shapes: a ranked
list, or **a single clarifying question** with options and counts. The spec
lists "fully autonomous workflows" under its Non-Goals and says the human
interface stays primary; a tool that declines to guess is the most direct
expression of that intent we could build. It puts the person back in the loop
at the exact moment the machine cannot decide — not as a permission prompt
bolted on afterwards, but because the site genuinely does not know and says
so.

## How it creates a better user experience

**The store listens the way an agent talks.** A search box gets "leather
belt". An agent relaying a person gets "I'm looking for a leather belt,
nothing with a snap, not over $50". Fed to a keyword matcher, that sentence
requires "looking" to appear in a title, reads "snap" as a *requirement*, and
never sees the budget. Counterask parses budgets, refusals ("not leather",
"no laces", "nothing from Nike"), orderings ("cheapest", "best rated") and
stated attributes out of the sentence itself. Measured on 800 such sentences
written from real product records, refusals inverted into requirements went
from 100% to 0%, budgets broken in the top ten from 31% to 0%, and Hit@10 from
0.79 to 0.999 — under phrasings the parser was never tuned on as well.

**It never asks what it was told.** Anything stated is a constraint, not a
question. "No preference" is remembered, so the same question cannot come
straight back. The agent can pass whatever it already knows from the
conversation — attributes, exclusions, budget, facets the shopper does not
mind — structured, and structured input wins over the parse.

**It says what it heard, and what still differs.** Every result carries an
`understood` block echoing exactly how the request was read, so the agent can
check before trusting the answer and the person sees the same thing as chips.
When the store does answer, it names the attributes that still separate the
products shown — "eleven buckle, one pull-on" — so the agent can summarise
rather than read out a list.

**"No results" is never the last word.** When nothing survives every
requirement, the store lifts each one in turn, re-counts, and reports which is
doing the damage. The agent gets `relax`; the person gets buttons.

## What people and agents can do together that was difficult before

The person supplies the one thing the store cannot compute: which of two
equally good attributes they actually care about. The store supplies the one
thing the person cannot see: that this is the moment their answer matters,
which attribute it is, and what choosing each option would leave. The agent
carries the question across, in the person's own words, and carries the
answer back.

Before WebMCP this loop did not exist. An agent driving a site through its
DOM sees a grid, not a decision. A site behind a REST API cannot register a
tool that appears only while a question is open and vanishes when it is
answered — here `answer_question` does exactly that, so the tool list itself
tells the agent what the page is waiting for. And a person and an agent
clicking or calling land in the *same* function: one state machine, two
surfaces, nothing that can drift between what a human sees and what an agent
is told.

Concretely, in one session: "find me a wallet that's not leather, under $30"
→ the store returns 30 candidates and one question (*which category —
wallets, card cases, money clips?*) → the agent asks the person → the person
answers → the store answers with what still differs → the agent curates the
grid with `show_products` so the person sees the pick, not a transcript →
"why that one?" → `explain_ranking`, deterministic, quotable.

## How WebMCP was implemented

Seven tools registered with `document.modelContext.registerTool` (with a
`navigator.modelContext` fallback), all running in the tab — no server, no
model call, no tokens:

- `search_products` — the request in the shopper's words plus optional
  structured knowledge; returns `answer` or `need_more_evidence`.
- `answer_question` — **registered dynamically** only while a question is
  open, unregistered when it is answered or the search changes.
- `refine_search` (require or exclude), `list_attributes` (vocabulary with
  counts), `show_products` (agent-curated grid), `explain_ranking`,
  `reset_search`.

Behind them: a sentence parser (budget, ordering, refusals at both the
recorded-attribute and title-word level, stated attributes, filler); BM25
retrieval over 9,901 real products with length normalisation and a
required-word conjunction; a value-of-information stopping policy that asks
only when the best question is expected to remove at least ten candidates and
at least 18% of the pool, measured as expected survivors rather than entropy
(products carry several values of one attribute, so shares are not a
distribution) and scaled by how much of the pool records the attribute at all.

For browsers without WebMCP, the page offers a **scripted agent**: the same
tools registered against a stand-in `modelContext`, called in the order a real
agent would call them, with the conversation shown beside the grid and
labelled as a simulation. Open the live URL with `?agent=demo` to watch it.

Everything is measured, and the rejected ideas are kept in the code with their
numbers: a "clear leader, stop asking" rule was built twice and removed twice;
graded credit for unrecorded attributes was byte-identical at four settings
and removed. Two self-supervised benchmarks (two-word shopper; agent-relayed
sentences, with a held-out phrasing set), 45 hand-written parse cases and a
stand-in-`modelContext` test of the tool surface run with `npm test`.

---

## Demo video outline (< 3 minutes, with narration)

1. **0:00–0:20** The problem in one search: type `belt` → 97 belts, leader 5%
   ahead. "Any store would show you these. This one asks."
2. **0:20–0:50** The question panel: *What material — leather, nylon,
   polyester, cotton?* with counts. Click leather → the answer, and the trace
   explaining why it stopped asking.
3. **0:50–1:30** The sentence: type `I'm looking for a leather belt, nothing
   with a snap, not over $50`. Show the chips (you said · not · price), the
   `understood` echo in the trace, priced items first.
4. **1:30–2:15** Agent-driven (ChatGPT's browser or Chrome with WebMCP): ask
   the agent for "a wallet that's not leather, under $30". Show the tool-call
   log: `search_products` → question → `answer_question` appears in the tool
   list → the agent relays the question → answer → `show_products`. Point at
   `answer_question` vanishing afterwards.
5. **2:15–2:45** "No results" recovery: `linen suede belt under $12` → the
   relax buttons → 71 belts. Then `explain_ranking` on one product.
6. **2:45–3:00** Close on the README benchmark table. "Zero servers, zero
   tokens, one question at the right moment."
