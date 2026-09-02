// Counterask storefront.
//
// One state machine drives both surfaces. A person clicking an answer chip and
// an agent calling answer_question land in exactly the same function, so the
// page can never tell them apart and can never drift between them.

import { Catalog, decide, POLICY } from './engine.js';
import { registerTools } from './webmcp.js';

const el = (id) => document.getElementById(id);

const state = {
  catalog: null,
  query: '',
  constraints: {},   // facet -> [values]
  asks: 0,
  pending: null,     // the question currently on screen
  scored: [],
  shown: null,       // explicit id list when an agent curates the grid
};

const EXAMPLES = [
  'belt',
  'leather belt',
  'running shoes',
  'waterproof hiking boots',
  'wallet',
  'wool sweater',
];

// --- boot ---------------------------------------------------------------

async function boot() {
  const res = await fetch('./data/catalog.json');
  const payload = await res.json();
  state.catalog = new Catalog(payload);

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

// --- core transitions ---------------------------------------------------

function search(query, actor = 'agent') {
  state.query = (query || '').trim();
  state.constraints = {};
  state.asks = 0;
  state.shown = null;
  return evaluate(actor);
}

function refine(facet, values, actor = 'agent') {
  if (!facet || !values?.length) return snapshot();
  state.constraints[facet] = values;
  state.shown = null;
  return evaluate(actor);
}

function answerQuestion(value, actor = 'agent') {
  const pending = state.pending;
  if (!pending) return snapshot();
  state.asks += 1;
  if (value === null) {              // "no preference" still costs a turn
    state.pending = null;
    return evaluate(actor, { skipped: pending.facet });
  }
  return refine(pending.facet, [value], actor);
}

function reset(actor = 'agent') {
  state.query = '';
  state.constraints = {};
  state.asks = 0;
  state.pending = null;
  state.shown = null;
  el('q').value = '';
  render({ action: 'idle', reasons: ['Waiting for a search.'], pool: [] });
  return snapshot();
}

function evaluate(actor, extra = {}) {
  const { catalog } = state;
  state.scored = catalog.search(state.query, state.constraints);
  const decision = decide(catalog, state.scored, state.constraints, state.asks);
  state.pending = decision.action === 'ask' ? decision : null;
  render(decision, extra);
  return snapshot(decision, extra);
}

// --- what both surfaces receive ----------------------------------------

function snapshot(decision, extra = {}) {
  const d = decision || { action: state.pending ? 'ask' : 'answer', pool: state.scored.map((s) => s.item), reasons: [] };
  const top = (state.shown
    ? state.shown.map((id) => state.catalog.byId.get(id)).filter(Boolean)
    : state.scored.slice(0, 12).map((s) => s.item));

  const base = {
    query: state.query,
    constraints: { ...state.constraints },
    questionsAsked: state.asks,
    candidates: d.pool?.length ?? 0,
    why: d.reasons ?? [],
    ...extra,
  };

  if (d.action === 'ask') {
    return {
      ...base,
      status: 'need_more_evidence',
      question: d.question,
      facet: d.facet,
      options: d.options,
      note: 'Answering now would be a guess. Put this question to the shopper, then call answer_question.',
    };
  }
  if (d.action === 'empty') {
    return { ...base, status: 'no_match', products: [] };
  }
  return { ...base, status: 'answer', products: top.map(serialize) };
}

function serialize(it) {
  return {
    id: it.id,
    title: it.t,
    brand: it.b || undefined,
    price: it.p ?? undefined,
    rating: it.r ?? undefined,
    reviews: it.n || undefined,
    attributes: it.f,
  };
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
  for (const [facet, values] of Object.entries(state.constraints)) {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = `<b>${facet}</b> ${values.join(' / ')}`;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', `Remove ${facet} filter`);
    x.addEventListener('click', () => {
      delete state.constraints[facet];
      state.asks = Math.max(0, state.asks - 1);
      evaluate('human');
    });
    c.append(x);
    wrap.append(c);
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
    b.innerHTML = `${o.value}<small>${o.count} items</small>`;
    b.addEventListener('click', () => answerQuestion(o.value, 'human'));
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

  const items = state.shown
    ? state.shown.map((id) => state.catalog.byId.get(id)).filter(Boolean)
    : state.scored.slice(0, 12).map((s) => s.item);

  el('statusTitle').textContent = d.action === 'ask'
    ? 'Best guess so far'
    : (state.shown ? 'Curated by the agent' : 'Recommended');
  el('statusN').textContent = `showing ${items.length} of ${d.pool.length} candidates`;

  for (const it of items) {
    const card = document.createElement('article');
    card.className = 'p';
    const tags = Object.entries(it.f).slice(0, 3)
      .map(([, vals]) => `<span class="tag">${vals[0]}</span>`).join('');
    card.innerHTML = `
      <div class="t">${escapeHtml(it.t)}</div>
      ${it.b ? `<div class="brand2">${escapeHtml(it.b)}</div>` : ''}
      <div class="tags">${tags}</div>
      <div class="meta">
        <span class="price">${it.p != null ? '$' + Number(it.p).toFixed(2) : '—'}</span>
        <span class="rating">${it.r ? `${it.r}★ · ${formatCount(it.n)}` : ''}</span>
      </div>`;
    grid.append(card);
  }
}

function renderTrace(d, extra) {
  const lines = [];
  lines.push(`<span class="k">query</span>      ${escapeHtml(state.query) || '—'}`);
  const cons = Object.entries(state.constraints).map(([k, v]) => `${k}=${v.join('|')}`).join('  ') || '—';
  lines.push(`<span class="k">known</span>      ${escapeHtml(cons)}`);
  lines.push(`<span class="k">candidates</span> ${d.pool?.length ?? 0}`);
  lines.push(`<span class="k">asked</span>      ${state.asks} / ${POLICY.maxAsks}`);
  if (extra.skipped) lines.push(`<span class="k">skipped</span>    ${extra.skipped}`);
  lines.push('');
  lines.push(`<span class="v">decision → ${d.action}</span>`);
  for (const r of d.reasons ?? []) lines.push(`  · ${escapeHtml(r)}`);
  el('trace').innerHTML = lines.join('\n');
}

function logCall(name, result) {
  el('callhint').hidden = true;
  const li = document.createElement('li');
  const summary = result?.status === 'need_more_evidence'
    ? `asked about ${result.facet}`
    : `${result?.products?.length ?? 0} products · ${result?.candidates ?? 0} candidates`;
  li.innerHTML = `<span class="nm">${escapeHtml(name)}()</span><br><span class="rs">${escapeHtml(summary)}</span>`;
  el('calls').prepend(li);
}

function escapeHtml(s) {
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
      matchedQueryTerms: hit.matched,
      attributesUsed: hit.item.f,
      popularitySignal: { rating: hit.item.r, reviews: hit.item.n },
      policy: {
        candidates: state.scored.length,
        questionsAsked: state.asks,
        maxAsks: POLICY.maxAsks,
        answerBelow: POLICY.answerBelow,
      },
      note: 'Score = IDF-weighted query coverage + 0.35 × log-scaled review demand. Deterministic; no model call.',
    };
  },
  facetValues() { return state.catalog.facetValues; },
};

boot();
