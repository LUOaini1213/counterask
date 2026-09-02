// Counterask storefront.
//
// One state machine drives both surfaces. A person clicking an answer chip and
// an agent calling answer_question land in exactly the same function, so the
// page can never tell them apart and can never drift between them.

import { Catalog, decide, parseRequest, POLICY } from './engine.js';
import { registerTools } from './webmcp.js';

const el = (id) => document.getElementById(id);

const SORTS = ['relevance', 'price_asc', 'price_desc', 'rating', 'popular'];
const SORT_LABEL = {
  relevance: 'relevance', price_asc: 'cheapest first', price_desc: 'priciest first',
  rating: 'best rated', popular: 'most reviewed',
};

const state = {
  catalog: null,
  vocab: null,          // facet -> [{ value, count }], computed once
  said: '',             // what was typed or passed, verbatim
  query: '',            // the product description left after parsing
  constraints: {},      // facet -> [values] the shopper requires
  exclude: {},          // facet -> [values] the shopper refused
  excludeTerms: [],     // words the shopper refused outright
  budget: null,         // { min, max } or null
  sort: 'relevance',
  optional: [],         // query words the filter already guarantees
  ignored: [],          // query words no product carries
  conflicts: [],        // a refusal naming a value the request also requires
  rejected: [],         // structured input this vocabulary does not have
  stated: new Set(),    // facets the shopper volunteered, vs ones we asked for
  declined: new Set(),  // facets the shopper said they do not mind
  asks: 0,
  pending: null,        // the question currently on screen
  scored: [],
  shown: null,          // explicit id list when an agent curates the grid
};

// The box parses sentences too, not just the tools. These show it.
const EXAMPLES = [
  'belt',
  'leather belt',
  'running shoes',
  'waterproof hiking boots, no laces',
  'a wallet that is not leather, under $30',
  'cheapest wool sweater',
];

// --- boot ---------------------------------------------------------------

async function boot() {
  const res = await fetch('./data/catalog.json');
  const payload = await res.json();
  state.catalog = new Catalog(payload);
  state.vocab = countVocab(state.catalog);

  el('examples').innerHTML = '';
  for (const q of EXAMPLES) {
    const b = document.createElement('button');
    b.textContent = q;
    b.addEventListener('click', () => { el('q').value = q; search(q, 'human'); });
    el('examples').append(b);
  }

  el('go').addEventListener('click', () => search(el('q').value, 'human'));
  el('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(el('q').value, 'human'); });
  el('clear').addEventListener('click', () => reset('human'));

  const ok = registerTools(api, logCall);
  el('mcpdot').classList.toggle('on', ok);
  el('mcpstate').textContent = ok ? 'WebMCP tools registered' : 'WebMCP not available in this browser';
}

function countVocab(catalog) {
  const counts = {};
  for (const facet of catalog.meta.facets) counts[facet] = new Map();
  for (const it of catalog.items) {
    for (const [facet, vals] of Object.entries(it.f)) {
      const m = counts[facet];
      if (!m) continue;
      for (const v of vals) m.set(v, (m.get(v) || 0) + 1);
    }
  }
  const out = {};
  for (const [facet, m] of Object.entries(counts)) {
    out[facet] = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }
  return out;
}

// --- core transitions ---------------------------------------------------

function search(text, actor = 'agent', given = {}) {
  const parsed = parseRequest(text || '', state.catalog);
  state.said = (text || '').trim();
  state.query = parsed.query;
  state.constraints = parsed.constraints;
  state.exclude = parsed.exclude;
  state.excludeTerms = parsed.excludeTerms;
  state.budget = parsed.budget;
  state.sort = parsed.sort;
  state.optional = parsed.optional;
  state.ignored = parsed.ignored;
  state.conflicts = parsed.conflicts;
  state.rejected = [];
  state.declined = new Set();
  state.asks = 0;
  state.shown = null;
  // Whatever the agent already knows arrives structured and wins over the
  // parse: it has the whole conversation, the store has one sentence.
  applyGiven(given ?? {});
  state.stated = new Set([...Object.keys(state.constraints), ...Object.keys(state.exclude)]);
  return evaluate(actor);
}

function applyGiven(given) {
  const cat = state.catalog;
  const accept = (facet, values) => {
    if (!cat.facetValues[facet]) { state.rejected.push({ facet, reason: 'no such attribute' }); return null; }
    const ok = [];
    for (const raw of [].concat(values ?? [])) {
      const v = canonical(facet, String(raw));
      if (v) { if (!ok.includes(v)) ok.push(v); } else state.rejected.push({ facet, value: raw, reason: 'not in this catalogue' });
    }
    return ok.length ? ok : null;
  };
  for (const [facet, values] of Object.entries(given.attributes ?? {})) {
    const ok = accept(facet, values);
    if (ok) state.constraints[facet] = ok;
  }
  for (const [facet, values] of Object.entries(given.exclude ?? {})) {
    const ok = accept(facet, values);
    if (ok) state.exclude[facet] = ok;
  }
  if (given.budget_max != null || given.budget_min != null) {
    state.budget = { min: given.budget_min ?? null, max: given.budget_max ?? null };
  }
  for (const facet of given.no_preference ?? []) {
    if (cat.facetValues[facet]) state.declined.add(facet);
    else state.rejected.push({ facet, reason: 'no such attribute' });
  }
  if (SORTS.includes(given.sort)) state.sort = given.sort;
}

// "waterproof" -> "water resistant": a value is accepted by its canonical name
// or by any surface form the builder mapped onto it. Category leaves match by
// head word, so "wallets" finds "wallets, card cases & money organizers".
function canonical(facet, raw) {
  const cat = state.catalog;
  const want = raw.trim().toLowerCase();
  const values = cat.facetValues[facet] ?? [];
  if (values.includes(want)) return want;
  for (const value of values) {
    if ((cat.facetForms?.[facet]?.[value] ?? []).includes(want)) return value;
  }
  return values.find((v) => v.split(/[,&]/)[0].trim() === want) ?? null;
}

function refine(facet, values, actor = 'agent', mode = 'require') {
  state.rejected = [];
  if (!facet || !values?.length) return snapshot();
  if (!state.catalog.facetValues[facet]) {
    state.rejected.push({ facet, reason: 'no such attribute' });
    return snapshot();
  }
  const ok = [];
  for (const raw of [].concat(values)) {
    const v = canonical(facet, String(raw));
    if (v) { if (!ok.includes(v)) ok.push(v); } else state.rejected.push({ facet, value: raw, reason: 'not in this catalogue' });
  }
  if (!ok.length) return snapshot();
  if (mode === 'exclude') state.exclude[facet] = ok; else state.constraints[facet] = ok;
  state.declined.delete(facet);
  state.shown = null;
  return evaluate(actor);
}

function answerQuestion(values, actor = 'agent') {
  const pending = state.pending;
  if (!pending) return snapshot();
  state.asks += 1;
  const list = [].concat(values ?? []).filter((v) => v != null && v !== '' && v !== 'no_preference');
  if (!list.length) {
    // "No preference" still costs a turn — and is remembered, so the same
    // question cannot come straight back.
    state.declined.add(pending.facet);
    state.pending = null;
    return evaluate(actor, { skipped: pending.facet });
  }
  return refine(pending.facet, list, actor);
}

function reset(actor = 'agent') {
  Object.assign(state, {
    said: '', query: '', constraints: {}, exclude: {}, excludeTerms: [], budget: null,
    sort: 'relevance', optional: [], ignored: [], conflicts: [], rejected: [],
    stated: new Set(), declined: new Set(), asks: 0, pending: null, scored: [], shown: null,
  });
  el('q').value = '';
  render({ action: 'idle', reasons: ['Waiting for a search.'], pool: [] });
  return snapshot();
}

function evaluate(actor, extra = {}) {
  const { catalog } = state;
  state.scored = catalog.search(state.query, state.constraints, {
    exclude: state.exclude,
    excludeTerms: state.excludeTerms,
    budget: state.budget,
    sort: state.sort,
    optional: state.optional,
  });
  const decision = decide(catalog, state.scored, state.constraints, state.asks, { declined: [...state.declined] });
  state.pending = decision.action === 'ask' ? decision : null;
  render(decision, extra);
  return snapshot(decision, extra);
}

// --- what both surfaces receive ----------------------------------------

function shownItems() {
  return state.shown
    ? state.shown.map((id) => state.catalog.byId.get(id)).filter(Boolean)
    : state.scored.slice(0, POLICY.show).map((s) => s.item);
}

function snapshot(decision, extra = {}) {
  const d = decision || { action: state.pending ? 'ask' : 'answer', pool: state.scored.map((s) => s.item), reasons: [] };
  const pool = d.pool ?? [];
  const top = shownItems();

  const understood = {
    query: state.query,
    attributes: { ...state.constraints },
    exclude: { ...state.exclude },
    excludeWords: [...state.excludeTerms],
    budget: state.budget,
    sort: state.sort,
    noPreference: [...state.declined],
    ignoredWords: [...state.ignored],
  };
  if (state.conflicts.length) understood.conflicts = state.conflicts;
  if (state.rejected.length) understood.rejected = state.rejected;

  const base = {
    request: state.said,
    understood,
    questionsAsked: state.asks,
    candidates: pool.length,
    why: d.reasons ?? [],
    ...extra,
  };
  if (state.budget) {
    const priced = pool.filter((it) => typeof it.p === 'number').length;
    base.candidatesWithPrice = priced;
    base.candidatesWithoutPrice = pool.length - priced;
  }

  if (d.action === 'ask') {
    return {
      ...base,
      status: 'need_more_evidence',
      question: d.question,
      facet: d.facet,
      options: d.options,
      note: 'Answering now would be a guess. Put this question to the shopper, then call answer_question — '
        + 'or, if the conversation already answers it, call answer_question straight away.',
    };
  }
  if (d.action === 'empty') {
    return { ...base, status: 'no_match', products: [], note: 'No product satisfies every requirement. Drop one with refine_search, or search again.' };
  }
  const diffs = d.differentiators ?? [];
  const describe = ({ facet, splits }) =>
    `${facet} (${splits.map((s) => `${s.count} ${headWord(s.value)}`).join(', ')})`;
  return {
    ...base,
    status: 'answer',
    products: top.map(serialize),
    differentiators: diffs,
    note: diffs.length
      ? `Showing ${top.length} of ${pool.length}. They differ mainly by ${diffs.map(describe).join(' and ')}. `
        + 'Narrow with refine_search, or curate the grid with show_products.'
      : `Showing ${top.length} of ${pool.length}. No recorded attribute separates them further.`,
  };
}

function serialize(it) {
  return {
    id: it.id,
    title: it.t,
    brand: it.b || undefined,
    price: typeof it.p === 'number' ? it.p : undefined,
    rating: it.r ?? undefined,
    reviews: it.n || undefined,
    attributes: it.f,
  };
}

function headWord(value) {
  return value.split(/[,&]/)[0].trim() || value;
}

function describeBudget(b) {
  if (!b) return '';
  if (b.min != null && b.max != null) return `$${b.min}–$${b.max}`;
  if (b.max != null) return `under $${b.max}`;
  return `over $${b.min}`;
}

// --- rendering ----------------------------------------------------------

function render(decision, extra = {}) {
  renderChips();
  renderAsk(decision);
  renderGrid(decision);
  renderTrace(decision, extra);
}

function renderChips() {
  const wrap = el('chips');
  wrap.innerHTML = '';
  const chip = (html, cls, onRemove, label) => {
    const c = document.createElement('span');
    c.className = `chip ${cls}`.trim();
    c.innerHTML = html;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', label);
    x.addEventListener('click', () => { onRemove(); evaluate('human'); });
    c.append(x);
    wrap.append(c);
  };
  for (const [facet, values] of Object.entries(state.constraints)) {
    const how = state.stated.has(facet) ? 'you said' : 'you chose';
    chip(`<b>${esc(facet)}</b> ${esc(values.join(' / '))} <i>${how}</i>`, '', () => {
      delete state.constraints[facet];
      if (!state.stated.has(facet)) state.asks = Math.max(0, state.asks - 1);
    }, `Remove ${facet} filter`);
  }
  for (const [facet, values] of Object.entries(state.exclude)) {
    chip(`<b>not</b> ${esc(values.join(' / '))} <i>${esc(facet)}</i>`, 'no',
      () => { delete state.exclude[facet]; }, `Stop excluding ${facet}`);
  }
  for (const word of state.excludeTerms) {
    chip(`<b>not</b> ${esc(word)}`, 'no',
      () => { state.excludeTerms = state.excludeTerms.filter((w) => w !== word); }, `Stop excluding ${word}`);
  }
  if (state.budget) {
    chip(`<b>price</b> ${esc(describeBudget(state.budget))}`, '', () => { state.budget = null; }, 'Remove budget');
  }
  if (state.sort !== 'relevance') {
    chip(`<b>sort</b> ${esc(SORT_LABEL[state.sort])}`, '', () => { state.sort = 'relevance'; }, 'Remove sort');
  }
  for (const facet of state.declined) {
    chip(`<b>${esc(facet)}</b> any <i>no preference</i>`, 'any',
      () => { state.declined.delete(facet); }, `Forget no preference on ${facet}`);
  }
}

function renderAsk(d) {
  const box = el('ask');
  if (d.action !== 'ask') { box.hidden = true; return; }
  box.hidden = false;
  el('askwhy').textContent = `Not enough evidence — ${d.pool.length} candidates, top only ${(d.separation * 100).toFixed(0)}% clear`;
  el('askq').textContent = d.question;
  const opts = el('askopts');
  opts.innerHTML = '';
  for (const o of d.options) {
    const b = document.createElement('button');
    b.innerHTML = `${esc(o.label ?? o.value)}<small>${o.count} items</small>`;
    b.addEventListener('click', () => answerQuestion([o.value], 'human'));
    opts.append(b);
  }
  const skip = document.createElement('button');
  skip.className = 'skip';
  skip.textContent = 'No preference';
  skip.addEventListener('click', () => answerQuestion(null, 'human'));
  opts.append(skip);
}

function renderGrid(d) {
  const grid = el('grid');
  const empty = el('empty');
  grid.innerHTML = '';

  if (d.action === 'idle') {
    el('statusTitle').textContent = 'Start a search';
    el('statusN').textContent = '';
    empty.hidden = true;
    return;
  }
  if (d.action === 'empty') {
    el('statusTitle').textContent = 'No match';
    el('statusN').textContent = '0 of 9,901';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const items = shownItems();
  el('statusTitle').textContent = d.action === 'ask'
    ? 'Best guess so far'
    : (state.shown ? 'Curated by the agent' : 'Recommended');
  el('statusN').textContent = `showing ${items.length} of ${d.pool.length} candidates`;

  for (const it of items) {
    const card = document.createElement('article');
    card.className = 'p';
    const tags = Object.entries(it.f).filter(([k]) => k !== 'kind').slice(0, 3)
      .map(([, vals]) => `<span class="tag">${esc(vals[0])}</span>`).join('');
    const price = typeof it.p === 'number'
      ? `$${it.p.toFixed(2)}`
      : (state.budget ? '<span class="dim">price not listed</span>' : '—');
    card.innerHTML = `
      <div class="t">${esc(it.t)}</div>
      ${it.b ? `<div class="brand2">${esc(it.b)}</div>` : ''}
      <div class="tags">${tags}</div>
      <div class="meta">
        <span class="price">${price}</span>
        <span class="rating">${it.r ? `${it.r}★ · ${formatCount(it.n)}` : ''}</span>
      </div>`;
    grid.append(card);
  }
}

function renderTrace(d, extra) {
  const lines = [];
  const k = (label, value) => lines.push(`<span class="k">${label.padEnd(10)}</span> ${esc(value)}`);
  k('request', state.said || '—');
  k('query', state.query || '—');
  const cons = Object.entries(state.constraints).map(([f, v]) => `${f}=${v.join('|')}`).join('  ');
  k('known', cons || '—');
  const nots = [
    ...Object.entries(state.exclude).map(([f, v]) => `${f}≠${v.join('|')}`),
    ...state.excludeTerms.map((w) => `"${w}"`),
  ].join('  ');
  if (nots) k('not', nots);
  if (state.budget) k('price', describeBudget(state.budget));
  if (state.sort !== 'relevance') k('sort', SORT_LABEL[state.sort]);
  if (state.declined.size) k('any', [...state.declined].join('  '));
  if (state.ignored.length) k('ignored', state.ignored.join('  '));
  for (const c of state.conflicts) k('conflict', `"${c.value}" both required and refused — kept`);
  k('candidates', String(d.pool?.length ?? 0));
  k('asked', `${state.asks} / ${POLICY.maxAsks}`);
  if (extra.skipped) k('skipped', extra.skipped);
  lines.push('');
  lines.push(`<span class="v">decision → ${d.action}</span>`);
  for (const r of d.reasons ?? []) lines.push(`  · ${esc(r)}`);
  for (const diff of d.differentiators ?? []) {
    lines.push(`  · shown items differ by ${esc(diff.facet)}: ${esc(diff.splits.map((s) => `${headWord(s.value)} ${s.count}`).join(', '))}`);
  }
  el('trace').innerHTML = lines.join('\n');
}

function logCall(name, result) {
  el('callhint').hidden = true;
  const li = document.createElement('li');
  const summary = result?.status === 'need_more_evidence'
    ? `asked about ${result.facet}`
    : (result?.products
      ? `${result.products.length} products · ${result.candidates ?? 0} candidates`
      : 'ok');
  li.innerHTML = `<span class="nm">${esc(name)}()</span><br><span class="rs">${esc(summary)}</span>`;
  el('calls').prepend(li);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatCount(n) {
  if (!n) return '0 reviews';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k reviews`;
  return `${n} reviews`;
}

// --- the surface WebMCP tools drive ------------------------------------

const api = {
  search, refine, answerQuestion, reset, snapshot,
  get state() { return state; },
  showProducts(ids) {
    state.shown = ids.filter((id) => state.catalog.byId.has(id));
    render({ action: 'answer', pool: state.scored.map((s) => s.item), reasons: ['Grid curated by the agent.'] });
    return snapshot();
  },
  explain(id) {
    const hit = state.scored.find((s) => s.item.id === id);
    if (!hit) return { error: `"${id}" is not in the current candidate set.` };
    return {
      id,
      title: hit.item.t,
      rank: state.scored.indexOf(hit) + 1,
      score: Number(hit.score.toFixed(3)),
      matchedWords: hit.matched,
      matchesWholeRequest: Boolean(hit.full),
      attributesUsed: hit.item.f,
      popularitySignal: { rating: hit.item.r, reviews: hit.item.n },
      policy: {
        candidates: state.scored.length,
        questionsAsked: state.asks,
        maxAsks: POLICY.maxAsks,
        answerBelow: POLICY.answerBelow,
        sort: state.sort,
        budget: state.budget,
      },
      note: 'Score = BM25 over title and attribute words (IDF-weighted, length-normalised) '
        + '× coverage of the required words + 0.35 × log-scaled review demand. '
        + 'Deterministic; no model call.',
    };
  },
  vocab() { return state.vocab; },
};

boot();
