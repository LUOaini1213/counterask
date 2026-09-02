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

const TOOLS = 'modelContext' in document;

export function registerTools(api, onCall) {
  if (!TOOLS) return false;

  let answerToolHandle = null;

  // Wrap every handler so the page's own activity log sees agent traffic.
  const traced = (name, fn) => async (args) => {
    const result = await fn(args ?? {});
    syncAnswerTool(result);
    onCall?.(name, result);
    return result;
  };

  // answer_question only exists while a question is on the table. An agent
  // reading the tool list can see, without being told, that the page is
  // waiting on the shopper.
  async function syncAnswerTool(result) {
    const pending = result?.status === 'need_more_evidence';
    if (pending && !answerToolHandle) {
      answerToolHandle = await document.modelContext.registerTool({
        name: 'answer_question',
        description:
          'Answer the clarifying question the store is currently asking. Only call this ' +
          'after putting the question to the shopper — the whole point is that the store ' +
          'will not guess this attribute on their behalf. Pass no_preference when the ' +
          'shopper genuinely does not mind.',
        inputSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              description:
                'One of the option values the store offered, or "no_preference".',
            },
          },
          required: ['value'],
        },
        execute: traced('answer_question', ({ value }) =>
          api.answerQuestion(value === 'no_preference' ? null : value, 'agent')),
      });
    } else if (!pending && answerToolHandle) {
      try { await answerToolHandle.unregister?.(); } catch { /* handle may be a plain token */ }
      answerToolHandle = null;
    }
  }

  const register = (spec) => document.modelContext.registerTool(spec);

  register({
    name: 'search_products',
    description:
      'Search 9,901 menswear products by free-text description. Returns one of two ' +
      'things: a ranked product list when the evidence supports ranking, or a single ' +
      'clarifying question when it does not. A question is not a failure — it means ' +
      'answering now would be a coin flip between near-identical items, and one ' +
      'attribute would settle it. Check the status field.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What the shopper is after, in their own words. e.g. "a leather belt".',
        },
      },
      required: ['query'],
    },
    execute: traced('search_products', ({ query }) => api.search(query, 'agent')),
  });

  register({
    name: 'refine_search',
    description:
      'Apply an attribute the shopper has already volunteered, without waiting to be ' +
      'asked. Use this when their message already contains the fact — "a waterproof one", ' +
      '"something machine washable". Returns the same two shapes as search_products.',
    inputSchema: {
      type: 'object',
      properties: {
        facet: {
          type: 'string',
          enum: ['material', 'closure', 'sleeve', 'fit', 'care', 'origin', 'sole', 'occasion', 'pocket', 'waterproof'],
          description: 'Which attribute the shopper stated.',
        },
        values: {
          type: 'array',
          items: { type: 'string' },
          description: 'Accepted values for that attribute. Call list_attributes for the vocabulary.',
        },
      },
      required: ['facet', 'values'],
    },
    execute: traced('refine_search', ({ facet, values }) => api.refine(facet, values, 'agent')),
  });

  register({
    name: 'list_attributes',
    description:
      'The attribute vocabulary this catalog actually carries, per facet. Use it to map ' +
      'a shopper\'s wording onto values refine_search will accept.',
    inputSchema: { type: 'object', properties: {} },
    execute: traced('list_attributes', async () => ({ status: 'answer', facets: api.facetValues() })),
  });

  register({
    name: 'show_products',
    description:
      'Replace the visible product grid with a specific set of ids, in your order. Use it ' +
      'after applying judgement the store cannot — reading images, weighing the shopper\'s ' +
      'stated budget — so the person sees what you picked rather than a chat transcript.',
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
      'Why a given product sits where it does: its score decomposition, which query terms ' +
      'matched, the demand signal, and the stopping policy state. Deterministic, so the ' +
      'same answer every time — quote it to the shopper if they ask why.',
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
    description: 'Clear the query, every stated attribute, and the question budget.',
    inputSchema: { type: 'object', properties: {} },
    execute: traced('reset_search', async () => api.reset('agent')),
  });

  return true;
}
