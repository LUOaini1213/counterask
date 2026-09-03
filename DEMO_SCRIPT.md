# Demo video — shot list

Every number below was read off the running app, not estimated. If a number on
screen disagrees with this script, the script is wrong; re-check before recording.

Target length ~2:30. Check the official rules for a maximum before you upload.

**Setup before you hit record**

- Load the page once and let the fonts settle, then reload. Do not record the
  first cold load.
- Browser at 1440×900 or wider, so the left rail and the grid are both visible.
- Zoom 110% — the option counts and the `why` lines have to be legible at
  YouTube's compression.
- Clear the cart (reload the page) and clear the search.
- Nothing else in the tab strip.

---

## 0:00–0:20 — The problem, stated with the product

**Do:** type `belt`, press Search.

**On screen:** grid fills, header line reads *96 candidates, showing 24*, and the
ink-blue block appears on the left: **"What material are you after — leather,
nylon, canvas, suede?"**

**Say:**
> Ninety-six belts match. Every one of them is a belt, and the top-ranked one
> beats the tenth by a rounding error. Ranking them is a coin flip. So this store
> doesn't. It asks.

---

## 0:20–0:40 — The question is a measurement, not a fallback

**Do:** hover slowly across the option chips — `leather`, then `nylon`.

**On screen:** products that answer would eliminate fade out; the line above the
grid updates live — *answering "leather" leaves 19 of these 24*.

**Do:** point at the `Why` list underneath.

**On screen:**
> 96 candidates, leader only 5% ahead.
> Asking "material" clears ~50 of them on average (recorded on 90%).
> fit looks stronger but is recorded on only 7% — that removes products for
> having no data.

**Say:**
> It picked this question by counting how many candidates each attribute would
> clear. Fit looks like the best question — it would remove 94% — but only 7% of
> the catalog records a fit, so it would be removing products for having no data.
> The store says that out loud instead of quietly picking the wrong question.

---

## 0:40–1:00 — It also knows when *not* to ask

**Do:** type `waterproof hiking boots, no laces`.

**On screen:** *8 candidates*. No question block. `Why` reads *8 candidates — few
enough to just look at.* Chips above the grid show `water resistant`, `outdoor`,
and a red struck **`not lace-up`**.

**Say:**
> Eight left, so it answers. And it read "no laces" as a refusal — not as a
> requirement that the word "laces" appear in the title, which is what a search
> box does with that sentence.

---

## 1:00–1:25 — Reading a whole sentence

**Do:** type `I'm looking for a leather belt, nothing with a snap, not over $50`.

**On screen:** chips read `leather` · `not snap` · `under $50` · *ignored: i'm
looking for, a*. Result: *36 candidates*, and it asks about what it's for.

**Say:**
> An agent relaying a person doesn't send "leather belt" — it sends the sentence.
> A keyword matcher gets three things wrong here at once: it hunts for the word
> "looking", it reads "snap" as something you want, and it never sees the budget.
> The store shows you how it read you, so you can check it before you trust it.
> On eight hundred sentences, that's six hundred and seven inverted refusals and
> two hundred and twenty-three broken budgets — down to zero.

---

## 1:25–1:50 — Changing your mind

**Do:** click the example chip *actually, ignore my earlier preference — a nylon
belt*.

**On screen:** an italic red chip **following the change**, a struck-through
**leather**, a live **nylon**, and **under $50** still standing.

**Say:**
> People take things back. It dropped leather, kept the budget, and shows you
> what it dropped rather than silently changing its mind for you. The agent gets
> the same thing back as `superseded`.

> Before this existed the store did something worse than ignore it — the word
> "scratch" fell through and got used to match product names.

---

## 1:50–2:10 — When nothing survives

**Do:** click the example *waterproof insulated silk gloves under $15*.

**On screen:** *0 candidates*, and under `Why` a red button: **material = silk →
42**.

**Do:** click it.

**Say:**
> Three requirements and a budget can empty a catalog, and "no results" is the
> least useful thing a store can say. It lifts each requirement in turn, re-counts,
> and tells you which one is doing the damage.

---

## 2:10–2:30 — The agent, and the line it doesn't cross

**Do:** scroll the left rail to **Tools on offer right now**, then hit **Run the
scripted agent**.

**On screen:** the conversation plays; `answer_question` appears in the tool list
when a question opens and disappears when it is answered. The agent drops the
budget, curates the grid, adds to the cart, fills checkout — and stops.

**Say:**
> `answer_question` is registered only while a question is open and removed by
> aborting its signal, so an agent reading the tool list can see what the page is
> waiting for. A person clicking a chip and an agent calling the tool enter the
> same function — the page can't tell a human one thing and an agent another.
>
> And checkout is a declarative form with no autosubmit. The agent fills it in.
> The last press is yours.

**Final frame:** the header badge, plus the line *no server, no model call, no
tokens — 86 KB*.

---

## Things not to do on camera

- Don't configure the Chrome flag on camera. Have the browser already in the mode
  you want, and let the header badge state it in one shot.
- Don't read the README aloud. Every claim in this script is visible on screen
  while you say it; if it isn't, cut the claim.
- Don't say "as you can see". Say the number.
