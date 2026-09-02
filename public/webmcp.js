// WebMCP surface.
//
// The store exposes its dialogue policy, not just its database. search_products
// can come back with a question instead of a product list, and while that
// question is open an extra tool — answer_question — exists to close it. The
// tool list itself tells the agent what the page is waiting for.
//
// That shape is the spec's own stated intent rather than a workaround: WebMCP
// lists "fully autonomous workflows" under Non-Goals and says the human
// interface stays primary. A tool that declines to guess is how a storefront
// puts the person back in the loop at the one moment it matters.

const context = () => document.modelContext ?? navigator.modelContext ?? null;

const FACETS = ['material', 'closure', 'sleeve', 'fit', 'care', 'origin', 'sole', 'occasion', 'pocket', 'waterproof', 'kind'];

const facetMap = (what) => ({
  type: 'object',
  description: `${what} Keys are facets — ${FACETS.join(', ')} — values are arrays of attribute values. `
    + 'Surface wording is accepted ("waterproof" for "water resistant", "wallets" for the category leaf); '
    + 'call list_attributes for the exact vocabulary and counts.',
  additionalProperties: { type: 'array', items: { type: 'string' } },
});

// `ctx` is the browser's modelContext by default. The scripted demo passes a
// stand-in, so the same registration code runs against both.
export function registerTools(api, onCall, ctx = context()) {
  if (!ctx?.registerTool) return false;

  let answerToolHandle = null;

  // Wrap every handler so the page's own activity log sees agent traffic.
  const traced = (name, fn) => async (args) => {
    const result = await fn(args ?? {});
    await syncAnswerTool(result);
    onCall?.(name, result);
    return result;
  };

  // answer_question only exists while a question is on the table. An agent
  // reading the tool list can see, without being told, that the page is
  // waiting on the shopper.
  async function syncAnswerTool(result) {
    const pending = result?.status === 'need_more_evidence';
    if (pending && !answerToolHandle) {
      answerToolHandle = await ctx.registerTool({
        name: 'answer_question',
        description:
          'Answer the clarifying question the store is currently asking. Put the question to the '
          + 'shopper first unless the conversation already answers it — the whole point is that the '
          + 'store will not guess this attribute on their behalf. Pass one or more of the option '
          + 'values offered ("leather or suede" is two values), or "no_preference" when the shopper '
          + 'genuinely does not mind; the store then stops asking about that attribute.',
        inputSchema: {
          type: 'object',
          properties: {
            values: {
              type: 'array',
              items: { type: 'string' },
              description: 'Option values from the question, or ["no_preference"].',
            },
            value: { type: 'string', description: 'A single option value, if you prefer.' },
          },
        },
        execute: traced('answer_question', ({ values, value }) =>
          api.answerQuestion(values ?? (value != null ? [value] : []), 'agent')),
      });
    } else if (!pending && answerToolHandle) {
      try { await answerToolHandle.unregister?.(); } catch { /* handle may be a plain token */ }
      answerToolHandle = null;
    }
  }

  const register = (spec) => ctx.registerTool(spec);

  register({
    name: 'search_products',
    description:
      'Search 9,901 menswear products. Pass the shopper\'s request in their own words: the store '
      + 'reads budgets ("under $40", "between 20 and 30 dollars"), refusals ("not leather", '
      + '"no laces", "nothing from Nike"), orderings ("cheapest", "best rated") and stated '
      + 'attributes ("long sleeve", "waterproof") out of the sentence itself, and never asks '
      + 'about anything already said. Anything you already know from the conversation can also '
      + 'be passed structured; structured input wins over the parse. '
      + 'Returns one of two shapes. status "answer": ranked products, plus "differentiators" '
      + 'naming the attributes that still separate them, so you can summarise rather than list. '
      + 'status "need_more_evidence": one clarifying question, because ranking now would be a coin '
      + 'flip between near-identical items and one attribute would settle it — put it to the '
      + 'shopper, then call answer_question. Either way, "understood" echoes exactly how the '
      + 'request was read; check it if a result looks off.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The request, in the shopper\'s words. A whole sentence is fine.',
        },
        attributes: facetMap('Attributes the shopper requires.'),
        exclude: facetMap('Attributes the shopper refuses.'),
        budget_max: { type: 'number', description: 'Ceiling in dollars. Products with no listed price are kept, ranked after priced ones.' },
        budget_min: { type: 'number', description: 'Floor in dollars.' },
        no_preference: {
          type: 'array',
          items: { type: 'string', enum: FACETS },
          description: 'Facets the shopper said they do not mind. The store will not ask about these.',
        },
        sort: {
          type: 'string',
          enum: ['relevance', 'price_asc', 'price_desc', 'rating', 'popular'],
          description: 'Order of the answer. Default relevance.',
        },
      },
      required: ['query'],
    },
    execute: traced('search_products', ({ query, ...given }) => api.search(query, 'agent', given)),
  });

  register({
    name: 'refine_search',
    description:
      'Add one requirement or one refusal to the current search without starting over. Use it '
      + 'when the shopper adds a fact mid-conversation — "actually, leather", "not the zip one". '
      + 'Returns the same two shapes as search_products, and may come back with a question.',
    inputSchema: {
      type: 'object',
      properties: {
        facet: { type: 'string', enum: FACETS, description: 'Which attribute.' },
        values: {
          type: 'array',
          items: { type: 'string' },
          description: 'Accepted (or, with mode "exclude", refused) values. Surface wording is accepted.',
        },
        mode: { type: 'string', enum: ['require', 'exclude'], description: 'Default "require".' },
      },
      required: ['facet', 'values'],
    },
    execute: traced('refine_search', ({ facet, values, mode }) => api.refine(facet, values, 'agent', mode ?? 'require')),
  });

  register({
    name: 'list_attributes',
    description:
      'The attribute vocabulary this catalog actually carries, per facet, with how many products '
      + 'record each value. Use it to map a shopper\'s wording onto values the other tools accept, '
      + 'and to tell the shopper what is and is not on offer.',
    inputSchema: { type: 'object', properties: {} },
    execute: traced('list_attributes', async () => ({ status: 'answer', facets: api.vocab() })),
  });

  register({
    name: 'show_products',
    description:
      'Replace the visible product grid with a specific set of ids, in your order. Use it after '
      + 'applying judgement the store cannot — reading images, weighing what the shopper said '
      + 'three messages ago — so the person sees what you picked rather than a chat transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Product ids from a previous result, in the order to display.',
        },
      },
      required: ['ids'],
    },
    execute: traced('show_products', ({ ids }) => api.showProducts(ids ?? [])),
  });

  register({
    name: 'explain_ranking',
    description:
      'Why a given product sits where it does: which words matched, whether it matches the whole '
      + 'request, the demand signal, and the stopping-policy state. Deterministic, so the same '
      + 'answer every time — quote it to the shopper if they ask why.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'A product id from the current results.' },
      },
      required: ['id'],
    },
    execute: traced('explain_ranking', async ({ id }) => api.explain(id)),
  });

  register({
    name: 'reset_search',
    description: 'Clear the query, every requirement, refusal and budget, and the question budget.',
    inputSchema: { type: 'object', properties: {} },
    execute: traced('reset_search', async () => api.reset('agent')),
  });

  return true;
}
