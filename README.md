# Counterask — the store that asks back

A menswear storefront whose WebMCP tools return **a question** when answering
would be a guess.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).
9,901 real products. No server, no model call, no tokens.

---

## The idea

Every WebMCP storefront in this challenge will expose the same shape of tool:
`get-products`, `filter-products`, `show-products`. The spec's own e-commerce
example does exactly that. Those tools all share one assumption — that the
store's job is to **answer**.

For most of a shopping conversation that assumption is wrong.

Ask a catalog for "a leather belt" and 44 products match. Every one of them is
leather, every one is a belt, and the top-ranked item beats the runner-up by
1%. Ranking them is a coin flip dressed up as a recommendation. One more fact —
how it fastens — settles it. The store knows this. It has the distribution in
front of it. But a tool that can only return products has no way to say so, so
it returns its coin flip and lets the agent present a guess as an answer.

**Counterask gives the store a second move.** `search_products` returns one of
two things:

```jsonc
// enough evidence
{ "status": "answer", "products": [ … ], "candidates": 10,
  "why": ["10 candidates left — small enough to show."] }

// not enough evidence
{ "status": "need_more_evidence",
  "question": "How should it fasten — buckle, snap, button?",
  "facet": "closure",
  "options": [ {"value":"buckle","count":33}, … ],
  "why": ["44 candidates, leader only 1% ahead.",
          "Asking \"closure\" (recorded on 80% of them) removes ~13% on average."],
  "note": "Answering now would be a guess. Put this question to the shopper, then call answer_question." }
```

The question is not a failure path. It is the store declining to guess on the
shopper's behalf, and handing the agent the one question worth asking.

## Why this is the right shape for WebMCP specifically

The [specification](https://github.com/webmachinelearning/webmcp) lists under
**Non-Goals**:

> **Fully autonomous workflows**: The API is not intended for fully autonomous
> agents operating without human oversight.

and under design principles:

> The human web interface remains primary; agent tools **augment rather than
> replace** user interaction.

A tool that returns a question is the most direct expression of that intent we
could build. It puts the person back in the loop at the exact moment the
machine cannot decide — not as a permission prompt bolted on afterwards, but
because the site genuinely does not know and says so.

Two further things fall out of it:

**The tool list is state.** `answer_question` is registered only while a
question is open, and unregistered the moment it is answered. An agent reading
the available tools can see what the page is waiting for without being told.

**One code path, two surfaces.** A person clicking an answer chip and an agent
calling `answer_question` enter the same function. The page cannot drift
between what it shows a human and what it tells an agent, because there is only
one state machine.

## The tools

| Tool | What it does |
|---|---|
| `search_products` | Free-text search. Returns products **or** a question. |
| `answer_question` | *Registered only while a question is open.* Closes it. |
| `refine_search` | Apply an attribute the shopper already volunteered. |
| `list_attributes` | The attribute vocabulary this catalog actually carries. |
| `show_products` | Replace the grid with ids the agent picked, in its order. |
| `explain_ranking` | Score decomposition and policy state for one product. |
| `reset_search` | Clear query, attributes and question budget. |

## How the stopping policy works

`decide()` in [`public/engine.js`](public/engine.js) answers when any of these hold:

- **≤ 12 candidates** — the shopper can just look at the list.
- **Top match ≥ 18% clear of second** — no further question changes who wins.
- **3 questions already asked** — the budget is spent.
- **No remaining question earns its turn** — see below.

Otherwise it picks the attribute with the highest expected pool reduction and
asks about that one.

**Two details that took the most work:**

*Entropy is the textbook choice here and it is wrong for this data.* A product
carries several values of the same attribute at once — a shoe is both
`athletic` and `casual` — so the value shares are not a probability
distribution and `-Σp·log p` is meaningless. Counting expected survivors needs
no such assumption and produces a number a shopper can read: *answering this
cuts the pool by about this much.*

*Missing is not a mismatch.* Only 5% of this catalog records a `fit` value. A
naive gain calculation loves `fit` — asking it "removes 98% of candidates" —
but it removes them for having no data, not for failing the requirement. So
reduction is measured inside the covered subset and scaled by coverage, and any
attribute recorded on under 45% of the pool is not asked about at all.

The result, on the six built-in examples:

| Query | Candidates | Decision |
|---|---:|---|
| `waterproof hiking boots` | 10 | answer — small enough to show |
| `wallet` | 161 | answer — 81% are leather, so asking material is a wasted turn |
| `leather belt` | 44 | **ask** — how should it fasten? |
| `belt` | 92 | **ask** — what material? |
| `running shoes` | 199 | **ask** — what occasion? |

`wallet` is the one to look at. 161 candidates is a lot, and the store still
answers, because the only well-recorded attribute does not separate them. The
policy asks when a question helps — not when the pool is merely large.

## Running it

```bash
python scripts/build_catalog.py --source /path/to/catalog.jsonl   # optional, output is committed
python -m http.server 5173 --directory public
```

Then open `http://localhost:5173` in **ChatGPT's in-app browser**, or Chrome
with WebMCP enabled, to drive it with an agent. In any other browser the
storefront degrades to an ordinary — and fully working — search UI; the badge
in the header tells you which mode you are in.

```
public/
  index.html      storefront
  app.js          state machine + rendering (the one code path)
  engine.js       retrieval, attribute evidence, stopping policy
  webmcp.js       tool registration, including the dynamic answer_question
  data/catalog.json
scripts/
  build_catalog.py  50,000-product source catalog -> 3.0 MB browser index
  smoke.mjs         policy behaviour on the sample queries
  diag.mjs          per-attribute coverage and gain for a query
```

## Data

Products are the menswear slice (level-2 category `Men`) of the frozen
50,000-product catalog derived from **Amazon Reviews 2023**, McAuley Lab, UCSD.
9,901 items, 3.0 MB raw / 0.8 MB gzipped — the whole storefront ships to the
client. There is no ranking model and no training: demand is proxied by
log-scaled review volume, because a frozen catalog has no click log.

## License

MIT — see [LICENSE](LICENSE).
