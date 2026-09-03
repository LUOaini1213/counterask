// The WebMCP surface, exercised without a WebMCP browser.
//
// Chrome-with-WebMCP and ChatGPT's browser are the only places the real
// document.modelContext exists. Everything the surface promises can still be
// checked here against the stand-in the scripted demo uses, which follows the
// spec's shape: registerTool(tool, { signal }) resolves to nothing, aborting
// the signal unregisters, getTools() lists, toolchange fires. The part that
// matters most: answer_question appears only while a question is open and
// disappears the moment it is answered — through the signal, as the spec has
// it, not through a handle the spec does not return.
//
//   node scripts/tools_test.mjs

import assert from 'node:assert/strict';

globalThis.location ??= { origin: 'http://localhost' };
globalThis.document ??= {};

const { standInContext } = await import('../public/demo.js');
const { registerTools, listTools } = await import('../public/webmcp.js');

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
  parseOnly(query) { calls.push(['parse', query]); return { status: 'reading', query }; },
  revise(drop, all, actor) { calls.push(['revise', drop, all, actor]); return { status: 'answer', products: [], dropped: drop }; },
  addToCart(id, qty) { calls.push(['add', id, qty]); return { status: 'cart', items: [{ id, quantity: qty }], total: 0 }; },
  removeFromCart(id) { calls.push(['remove', id]); return { status: 'cart', items: [], total: 0 }; },
  cart() { return { status: 'cart', items: [], total: 0 }; },
  vocab() { return { material: [{ value: 'leather', count: 1 }] }; },
};

const ctx = standInContext();
const log = [];
const seen = [];
assert.equal(registerTools(api, (name, result) => log.push([name, result.status]), ctx, (names) => seen.push(names)), true);
await new Promise((r) => setTimeout(r, 0));   // registrations are asynchronous

const STATIC = ['add_to_cart', 'explain_ranking', 'list_attributes', 'parse_only', 'refine_search', 'remove_from_cart', 'reset_search', 'revise_search', 'search_products', 'show_products', 'view_cart'];
assert.deepEqual((await listTools(ctx)).sort(), STATIC);
assert.ok(!ctx.tools.has('answer_question'), 'no question is open, so answer_question must not exist yet');
assert.ok(seen.length >= 1 && seen.at(-1).length === STATIC.length, 'the page was told the tool names');

// Every registered tool has a title, and the read-only ones say so.
for (const t of await ctx.getTools()) assert.ok(t.title, `${t.name} has no title`);
assert.equal(ctx.tools.get('list_attributes').annotations.readOnlyHint, true);
assert.equal(ctx.tools.get('explain_ranking').annotations.readOnlyHint, true);
assert.equal(ctx.tools.get('view_cart').annotations.readOnlyHint, true);
assert.equal(ctx.tools.get('parse_only').annotations.readOnlyHint, true);

// A dry run reads without searching; a revision drops what it is told.
assert.equal((await ctx.tools.get('parse_only').execute({ query: 'not leather' })).structuredContent.status, 'reading');
assert.deepEqual(calls.at(-1), ['parse', 'not leather']);
await ctx.tools.get('revise_search').execute({ drop: ['leather', 'budget'] });
assert.deepEqual(calls.at(-1), ['revise', ['leather', 'budget'], false, 'agent']);
await ctx.tools.get('revise_search').execute({ drop_all: true });
assert.deepEqual(calls.at(-1), ['revise', [], true, 'agent']);

// Structured input travels with the query, untouched.
const search = ctx.tools.get('search_products');
assert.deepEqual(search.inputSchema.required, ['query']);
assert.deepEqual(Object.keys(search.inputSchema.properties).sort(),
  ['attributes', 'budget_max', 'budget_min', 'exclude', 'no_preference', 'query', 'sort']);
const settle = () => new Promise((r) => setTimeout(r, 5));
let wire = await search.execute({ query: 'a leather belt', budget_max: 30, no_preference: ['origin'] });
await settle();
assert.deepEqual(calls.at(-1), ['search', 'a leather belt', 'agent', { budget_max: 30, no_preference: ['origin'] }]);

// On the wire, both conventions at once: MCP text content and the object.
assert.equal(wire.content[0].type, 'text');
assert.deepEqual(JSON.parse(wire.content[0].text), wire.structuredContent);
let r = wire.structuredContent;
assert.equal(r.status, 'need_more_evidence');

// The question is open: the tool to close it now exists, and the page heard.
assert.ok(ctx.tools.has('answer_question'), 'a question is open, so answer_question must be registered');
assert.ok(seen.at(-1).includes('answer_question'), 'the page was told answer_question appeared');
const answer = ctx.tools.get('answer_question');
r = (await answer.execute({ values: ['leather', 'suede'] })).structuredContent;
await settle();
assert.deepEqual(calls.at(-1), ['answer', ['leather', 'suede'], 'agent']);
assert.equal(r.status, 'answer');
assert.ok(!ctx.tools.has('answer_question'), 'answered, so answer_question must be gone again — via the abort signal');
assert.ok(!seen.at(-1).includes('answer_question'), 'the page was told it went');

// A second question registers it again without tripping the duplicate check.
await search.execute({ query: 'belt' });
await settle();
assert.ok(ctx.tools.has('answer_question'));
await ctx.tools.get('answer_question').execute({ value: 'no_preference' });
await settle();
assert.deepEqual(calls.at(-1), ['answer', ['no_preference'], 'agent']);
assert.ok(!ctx.tools.has('answer_question'));

// refine_search carries its mode; the default is a requirement.
const refine = ctx.tools.get('refine_search');
await refine.execute({ facet: 'closure', values: ['zipper'], mode: 'exclude' });
assert.deepEqual(calls.at(-1), ['refine', 'closure', ['zipper'], 'agent', 'exclude']);
await refine.execute({ facet: 'material', values: ['leather'] });
assert.deepEqual(calls.at(-1), ['refine', 'material', ['leather'], 'agent', 'require']);
assert.ok(refine.inputSchema.properties.facet.enum.includes('kind'), 'the category tree is refinable');

// The cart tools reach the page; checkout is deliberately not among them.
await ctx.tools.get('add_to_cart').execute({ id: 'a', quantity: 2 });
assert.deepEqual(calls.at(-1), ['add', 'a', 2]);
await ctx.tools.get('add_to_cart').execute({ id: 'b' });
assert.deepEqual(calls.at(-1), ['add', 'b', 1]);
await ctx.tools.get('remove_from_cart').execute({ id: 'a' });
assert.deepEqual(calls.at(-1), ['remove', 'a']);
assert.equal((await ctx.tools.get('view_cart').execute({})).structuredContent.status, 'cart');
assert.ok(!ctx.tools.has('checkout') && !ctx.tools.has('place_order'), 'placing the order is the person\'s move');

// The rest are pass-throughs.
assert.deepEqual((await ctx.tools.get('list_attributes').execute({})).structuredContent.facets.material[0].value, 'leather');
await ctx.tools.get('show_products').execute({ ids: ['a', 'b'] });
assert.deepEqual(calls.at(-1), ['show', ['a', 'b']]);
await ctx.tools.get('explain_ranking').execute({ id: 'a' });
assert.deepEqual(calls.at(-1), ['explain', 'a']);
await ctx.tools.get('reset_search').execute({});
assert.deepEqual(calls.at(-1), ['reset', 'agent']);

// executeTool, as the spec has it, returns the serialized result.
const [tool] = (await ctx.getTools()).filter((t) => t.name === 'view_cart');
assert.equal(JSON.parse(await ctx.executeTool(tool, {})).structuredContent.status, 'cart');

// Every call reached the page's own activity log.
assert.ok(log.length >= 13, `expected the log to see every call, saw ${log.length}`);

// Without a modelContext the surface stays off and says so.
assert.equal(registerTools(api, () => {}, null), false);

console.log(`ok — ${calls.length} tool calls; answer_question registered and unregistered through its abort signal; ${seen.length} tool-list updates`);
