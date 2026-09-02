// The WebMCP surface, exercised without a WebMCP browser.
//
// Chrome-with-WebMCP and ChatGPT's browser are the only places the real
// document.modelContext exists. Everything the surface promises can still be
// checked here with a stand-in: which tools register, what each hands to the
// page, and — the part that matters most — that answer_question appears only
// while a question is open and disappears the moment it is answered.
//
//   node scripts/tools_test.mjs

import assert from 'node:assert/strict';

const registry = new Map();
globalThis.document = {
  modelContext: {
    async registerTool(spec) {
      registry.set(spec.name, spec);
      return { unregister: async () => { registry.delete(spec.name); } };
    },
  },
};

const { registerTools } = await import('../public/webmcp.js');

// A stand-in for the page: records what it was asked, answers by script.
const calls = [];
const api = {
  search(query, actor, given) {
    calls.push(['search', query, actor, given]);
    return query.includes('belt')
      ? { status: 'need_more_evidence', facet: 'material', question: 'What material?', options: [] }
      : { status: 'answer', products: [], candidates: 3 };
  },
  refine(facet, values, actor, mode) { calls.push(['refine', facet, values, actor, mode]); return { status: 'answer', products: [] }; },
  answerQuestion(values, actor) { calls.push(['answer', values, actor]); return { status: 'answer', products: [] }; },
  reset(actor) { calls.push(['reset', actor]); return { status: 'answer', products: [] }; },
  showProducts(ids) { calls.push(['show', ids]); return { status: 'answer', products: [] }; },
  explain(id) { calls.push(['explain', id]); return { id }; },
  vocab() { return { material: [{ value: 'leather', count: 1 }] }; },
};
const log = [];
assert.equal(registerTools(api, (name, result) => log.push([name, result.status])), true);

const names = () => [...registry.keys()].sort();
assert.deepEqual(names(), ['explain_ranking', 'list_attributes', 'refine_search', 'reset_search', 'search_products', 'show_products']);
assert.ok(!registry.has('answer_question'), 'no question is open, so answer_question must not exist yet');

// Structured input travels with the query, untouched.
const search = registry.get('search_products');
assert.deepEqual(search.inputSchema.required, ['query']);
assert.deepEqual(Object.keys(search.inputSchema.properties).sort(),
  ['attributes', 'budget_max', 'budget_min', 'exclude', 'no_preference', 'query', 'sort']);
let wire = await search.execute({ query: 'a leather belt', budget_max: 30, no_preference: ['origin'] });
assert.deepEqual(calls.at(-1), ['search', 'a leather belt', 'agent', { budget_max: 30, no_preference: ['origin'] }]);

// On the wire, both conventions at once: MCP text content and the object.
assert.equal(wire.content[0].type, 'text');
assert.deepEqual(JSON.parse(wire.content[0].text), wire.structuredContent);
let r = wire.structuredContent;
assert.equal(r.status, 'need_more_evidence');

// The question is open: the tool to close it now exists.
assert.ok(registry.has('answer_question'), 'a question is open, so answer_question must be registered');
const answer = registry.get('answer_question');
r = (await answer.execute({ values: ['leather', 'suede'] })).structuredContent;
assert.deepEqual(calls.at(-1), ['answer', ['leather', 'suede'], 'agent']);
assert.equal(r.status, 'answer');
assert.ok(!registry.has('answer_question'), 'answered, so answer_question must be gone again');

// The single-value form and "no_preference" reach the page as given; the page
// decides what they mean.
await search.execute({ query: 'belt' });
await registry.get('answer_question').execute({ value: 'no_preference' });
assert.deepEqual(calls.at(-1), ['answer', ['no_preference'], 'agent']);

// refine_search carries its mode; the default is a requirement.
const refine = registry.get('refine_search');
await refine.execute({ facet: 'closure', values: ['zipper'], mode: 'exclude' });
assert.deepEqual(calls.at(-1), ['refine', 'closure', ['zipper'], 'agent', 'exclude']);
await refine.execute({ facet: 'material', values: ['leather'] });
assert.deepEqual(calls.at(-1), ['refine', 'material', ['leather'], 'agent', 'require']);
assert.ok(refine.inputSchema.properties.facet.enum.includes('kind'), 'the category tree is refinable');

// The rest are pass-throughs.
assert.deepEqual((await registry.get('list_attributes').execute({})).structuredContent.facets.material[0].value, 'leather');
await registry.get('show_products').execute({ ids: ['a', 'b'] });
assert.deepEqual(calls.at(-1), ['show', ['a', 'b']]);
await registry.get('explain_ranking').execute({ id: 'a' });
assert.deepEqual(calls.at(-1), ['explain', 'a']);
await registry.get('reset_search').execute({});
assert.deepEqual(calls.at(-1), ['reset', 'agent']);

// Every call reached the page's own activity log.
assert.ok(log.length >= 9, `expected the log to see every call, saw ${log.length}`);

// Without a modelContext the surface stays off and says so.
delete globalThis.document.modelContext;
assert.equal(registerTools(api, () => {}), false);

console.log(`ok — ${calls.length} tool calls, answer_question registered and unregistered on cue`);
