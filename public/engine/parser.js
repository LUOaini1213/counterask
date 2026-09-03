/* The parser — fixed order, and every pass blanks the span it claims, so a
   word read one way is never read again another way. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory;
  else (root.CounteraskParts = root.CounteraskParts || {})["parser"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function (V, BRANDS) {
  "use strict";

  const { FACETS, FACET_LABEL, SURFACE_LIST, FILLER, STOPWORDS, NEVER_BANNED,
          REFUSAL_PATTERNS, WAIVE_PATTERNS, RESET_PATTERNS, REPLACE_PATTERNS,
          SUPERSEDE_PATTERNS } = V;

  function blank(str, start, end) {
    return str.slice(0, start) + " ".repeat(end - start) + str.slice(end);
  }

  /* ---------- the parser -----------------------------------------------
     Fixed order, and every pass blanks the span it claims, so a word read
     one way is never read again another way. "not over $50" is a budget
     before it is ever a refusal; "no-show" is a title word before "no" is
     ever a refusal.                                                        */

  /* ---------- the pipeline -----------------------------------------------
     Order is the whole design, so order is data: an array of named passes,
     run top to bottom. Each pass reads ctx.s, and anything it takes it takes
     through claim(), which blanks the span and writes a line of the trace.
     The trace is what parse_only returns — which word was read by which pass
     as what — so a reading can be audited instead of trusted.              */

  function claim(ctx, pass, start, end, readAs) {
    const text = ctx.s.slice(start, end).replace(/\s+/g, " ").trim();
    if (text) ctx.claims.push({ pass, text, read_as: readAs });
    ctx.s = blank(ctx.s, start, end);
  }

  const PASSES = [
    { name: "contractions", run(ctx) {
        // "that isn't leather" is a refusal; without this it is nothing at all.
        // don't / doesn't are left alone — they have their own patterns.
        ctx.s = ctx.s.replace(/\b(is|are|was|were|ai)n't\b/g, "$1 not").replace(/\bisnt\b/g, "is not");
      } },

    { name: "protected compounds", run(ctx) {
        // "no-show" is a name, not a refusal of "show"
        ctx.s.replace(/\b(no|not|non)-[a-z]+\b/g, (m, _g, i) => { ctx.protectedSpans.push([i, i + m.length, m]); return m; });
        for (const [a, b, m] of ctx.protectedSpans) claim(ctx, "protected compounds", a, b, "a title word: " + m.trim());
      } },

    { name: "size", run(ctx) {
        const re = /\bsize \d+(?:\.\d+)?\b|\bsize (?:small|medium|large|x-large|xl|xxl)\b/g;
        let m;
        while ((m = re.exec(ctx.s))) {
          ctx.u.ignored.push(m[0].trim() + " (no size data in this catalog)");
          claim(ctx, "size", m.index, m.index + m[0].length, "ignored — no size data in this catalog");
          re.lastIndex = 0;
        }
      } },

    { name: "number words", run(ctx) {
        // "under fifty dollars", "a hundred bucks", "one hundred and twenty".
        // Only in a money context — a keyword before or a money word after —
        // so "one size" and "two pockets" are left alone. Currency signs other
        // than $ are read as money too.
        ctx.s = ctx.s.replace(/[\u20ac\u00a3]\s*(\d)/g, "$$$1");
        const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
          eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
        const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
        const WORD = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and|-|\\s)+";
        const LEAD = "(?:under|below|over|above|around|about|roughly|approximately|max|maximum of|up to|at most|at least|less than|more than|cheaper than|not over|no more than|nothing over|between|budget is|budget of|i have|spend|\\$)\\s*";
        const TRAIL = "\\s*(?:dollars|bucks|usd|and\\s+" + WORD + "dollars)";
        const toNumber = (phrase) => {
          const w = phrase.toLowerCase().replace(/-/g, " ").replace(/\band\b/g, " ").trim().split(/\s+/).filter(Boolean);
          let total = 0, cur = 0, seen = false;
          for (const t of w) {
            if (t === "a" || t === "an") { cur = cur || 1; continue; }
            if (t in ONES) { cur += ONES[t]; seen = true; }
            else if (t in TENS) { cur += TENS[t]; seen = true; }
            else if (t === "hundred") { cur = (cur || 1) * 100; seen = true; }
            else if (t === "thousand") { cur = (cur || 1) * 1000; total += cur; cur = 0; seen = true; }
            else return null;
          }
          return seen ? total + cur : null;
        };
        const re = new RegExp("(" + LEAD + ")(" + WORD + ")(?=" + TRAIL + "|\\b)|(" + WORD + ")(?=" + TRAIL + ")", "g");
        ctx.s = ctx.s.replace(re, (m, lead, w1, w2) => {
          const words = (w1 || w2 || "").trim();
          if (!/[a-z]/.test(words)) return m;
          const n = toNumber(words);
          if (n == null || n === 0) return m;
          return (lead || "") + " " + n + " ";
        });
      } },

    { name: "budget", run(ctx) {
        // A number only reads as money with a $ or a money word or a budget
        // keyword, so "size 10" and "41mm" stay out of it.
        const rules = [
          [/\bbetween \$?(\d+(?:\.\d+)?) and \$?(\d+(?:\.\d+)?)\s*(?:dollars)?/g, (m) => ({ min: +m[1], max: +m[2] })],
          [/\bin the \$(\d+(?:\.\d+)?)\s*[-–to ]+\s*\$?(\d+(?:\.\d+)?) range/g, (m) => ({ min: +m[1], max: +m[2] })],
          [/\$(\d+(?:\.\d+)?)\s*[-–]\s*\$?(\d+(?:\.\d+)?)/g, (m) => ({ min: +m[1], max: +m[2] })],
          [/\b(?:not over|no more than|not more than|nothing over|nothing above|nothing more than|under|below|less than|cheaper than|max|maximum of|up to|at most)\s*\$?(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?/g, (m) => ({ max: +m[1] })],
          // a ceiling written as a negated floor — "nothing over $200" is a maximum
          [/\b(?:rather not|don'?t want to|do not want to|would rather not)\s+(?:spend|pay|go)\s+(?:over|above|more than)\s*\$?(\d+(?:\.\d+)?)/g, (m) => ({ max: +m[1] })],
          [/\bnot\s+(?:spend|pay|go)\s+(?:over|above|more than)\s*\$?(\d+(?:\.\d+)?)/g, (m) => ({ max: +m[1] })],
          [/\bi have \$?(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?(?: to spend)?/g, (m) => ({ max: +m[1] })],
          [/\bbudget (?:is |of )?\$?(\d+(?:\.\d+)?)/g, (m) => ({ max: +m[1] })],
          [/\b(?:over|above|more than|at least|starting at)\s*\$?(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?/g, (m) => ({ min: +m[1] })],
          [/\b(?:around|about|roughly|approximately)\s*\$?(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?/g, (m) => ({ min: Math.round(+m[1] * 0.8), max: Math.round(+m[1] * 1.2), approx: true })],
          [/\$(\d+(?:\.\d+)?)\b/g, (m) => ({ max: +m[1] })]
        ];
        for (const [re, make] of rules) {
          re.lastIndex = 0;
          const m = re.exec(ctx.s);
          if (!m) continue;
          ctx.u.budget = make(m);
          claim(ctx, "budget", m.index, m.index + m[0].length, "budget " + describeBudget(ctx.u.budget));
          break;
        }
      } },

    { name: "ordering", run(ctx) {
        const rules = [
          [/\b(?:the )?(?:cheapest|least expensive|lowest priced?|lowest price)\b/g, "price-asc"],
          [/\b(?:most expensive|priciest|highest priced?)\b/g, "price-desc"],
          [/\b(?:best|highest|top)[- ]rated\b/g, "rating"],
          [/\bbest reviewed\b/g, "rating"],
          [/\b(?:most popular|best sell(?:ing|er)s?|most reviewed)\b/g, "demand"]
        ];
        for (const [re, val] of rules) {
          re.lastIndex = 0;
          const m = re.exec(ctx.s);
          if (m && !ctx.u.sort) { ctx.u.sort = val; claim(ctx, "ordering", m.index, m.index + m[0].length, "sort " + val); }
        }
      } },

    { name: "waved through", run(ctx) {
        // before refusals, so "not fussy about the closure" is a waiver, not a refusal of "fussy"
        for (const re of WAIVE_PATTERNS) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(ctx.s))) {
            const facet = matchFacetName(m[1]);
            if (facet) { ctx.u.waived.push(facet); claim(ctx, "waved through", m.index, m.index + m[0].length, "no preference on " + facet); re.lastIndex = 0; }
          }
        }
      } },

    { name: "retraction", run(ctx) {
        // before refusals, so "ignore my earlier preference" is a change of mind
        // and not a refusal of "my"; before terms, so "scratch" never matches a title
        for (const re of SUPERSEDE_PATTERNS) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(ctx.s))) {
            const wanted = cutAtConjunction(m[1].trim());
            const dropped = m[2] ? cutAtConjunction(m[2].trim()) : null;
            ctx.u.retraction = ctx.u.retraction || { kind: "replace", drops: [], said: m[0].trim() };
            if (dropped) ctx.u.retraction.drops.push(dropped);
            const rel = m[0].indexOf(wanted);
            const start = m.index + (rel >= 0 ? rel + wanted.length : 0);
            claim(ctx, "retraction", start, m.index + m[0].length, "replace" + (dropped ? " — drop " + dropped : ""));
            re.lastIndex = 0;
          }
        }
        for (const re of RESET_PATTERNS) {
          re.lastIndex = 0;
          const m = re.exec(ctx.s);
          if (m) { ctx.u.retraction = { kind: "reset", drops: [], said: m[0].trim() }; claim(ctx, "retraction", m.index, m.index + m[0].length, "start over"); }
        }
        if (!ctx.u.retraction || ctx.u.retraction.kind !== "reset") {
          for (const re of REPLACE_PATTERNS) {
            re.lastIndex = 0;
            const m = re.exec(ctx.s);
            if (m) {
              ctx.u.retraction = ctx.u.retraction || { kind: "replace", drops: [], said: m[0].trim() };
              ctx.u.retraction.said = m[0].trim();
              claim(ctx, "retraction", m.index, m.index + m[0].length, "change of mind");
            }
          }
        }
      } },

    { name: "refusals", run(ctx) {
        // two levels: the recorded value is excluded, and the refused word is
        // banned from titles — which makes "not Ridgeline" work with no vocabulary
        for (const re of REFUSAL_PATTERNS) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(ctx.s))) {
            // The whole capture against the vocabulary first — "hook and loop"
            // is one value and must not be cut at its own "and". Only when the
            // vocabulary does not know the phrase is it cut at a conjunction,
            // so "no wool and no acrylic" is still two refusals.
            const raw = m[1].trim();
            const hit = matchSurface(raw) || matchSurface(cutAtConjunction(raw));
            const phrase = hit ? hit.matched : cutAtConjunction(raw);
            const brand = hit ? null : matchBrand(phrase);
            let consumed = false;
            const take = (endOfPhrase, readAs) => {
              const rel = m[0].indexOf(phrase);
              const end = m.index + (rel >= 0 ? rel + endOfPhrase : m[0].length);
              claim(ctx, "refusals", m.index, end, readAs);
              consumed = true;
            };
            if (hit) {
              ctx.u.exclusions.push({ facet: hit.facet, value: hit.value, said: hit.matched });
              ctx.u.bannedWords.push(hit.matched);
              take(phrase.length, "refuse " + hit.facet + " = " + hit.value);
            } else if (brand) {
              ctx.u.exclusions.push({ facet: "brand", value: brand, said: brand });
              ctx.u.bannedWords.push(brand.toLowerCase());
              take(phrase.length, "refuse brand " + brand);
            } else {
              const word = phrase.split(/\s+/)[0];
              if (word.length > 2 && !STOPWORDS.has(word) && !NEVER_BANNED.has(word)) {
                ctx.u.exclusions.push({ facet: null, value: word, said: word });
                ctx.u.bannedWords.push(word);
                take(word.length, "refuse the word \u201c" + word + "\u201d");
              }
            }
            // only rewind when the span is actually gone; rewinding after a
            // match we chose not to claim re-matches the same text forever
            if (consumed) re.lastIndex = 0;
          }
        }
      } },

    { name: "attributes", run(ctx) {
        // longest surface form first, so "stainless steel" is claimed before "steel"
        for (const entry of SURFACE_LIST) {
          const re = entry.re;
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(ctx.s))) {
            const dup = ctx.u.attributes.find(a => a.facet === entry.facet && a.value === entry.value);
            if (!dup) ctx.u.attributes.push({ facet: entry.facet, value: entry.value, said: entry.form });
            claim(ctx, "attributes", m.index, m.index + m[0].length, entry.facet + " = " + entry.value);
            re.lastIndex = 0;
          }
        }
      } },

    { name: "filler", run(ctx) {
        for (const f of FILLER) {
          let at;
          while ((at = ctx.s.indexOf(f)) >= 0) { ctx.u.ignored.push(f.trim()); claim(ctx, "filler", at, at + f.length, "ignored"); }
        }
      } },

    { name: "title words", run(ctx) {
        // whatever survives, plus the protected compounds, are title terms
        const leftovers = ctx.s.split(/[^a-z0-9'\-]+/).filter(Boolean);
        for (const [, , text] of ctx.protectedSpans) leftovers.push(text.trim());
        for (const w of leftovers) {
          if (STOPWORDS.has(w)) { ctx.u.ignored.push(w); ctx.claims.push({ pass: "title words", text: w, read_as: "stopword, ignored" }); continue; }
          if (w.length < 2) continue;
          if (ctx.u.terms.includes(w)) continue;
          ctx.u.terms.push(w);
          ctx.claims.push({ pass: "title words", text: w, read_as: "must appear in the title" });
        }
      } },

    { name: "conflicts", run(ctx) {
        // a value said and refused in the same breath
        for (const ex of ctx.u.exclusions) {
          const clash = ctx.u.attributes.find(a => a.facet === ex.facet && a.value === ex.value);
          if (clash) { ctx.u.conflicts.push(ex.value); ctx.claims.push({ pass: "conflicts", text: ex.value, read_as: "said both ways — neither applied" }); }
        }
        ctx.u.attributes = ctx.u.attributes.filter(a => !ctx.u.conflicts.includes(a.value));
      } }
  ];

  function describeBudget(b) {
    if (b.min != null && b.max != null) return "$" + b.min + "\u2013$" + b.max + (b.approx ? " (about)" : "");
    if (b.max != null) return "under $" + b.max;
    return "over $" + b.min;
  }

  function parse(sentence) {
    const original = String(sentence || "");
    const ctx = {
      s: " " + original.toLowerCase() + " ",
      protectedSpans: [],
      claims: [],
      u: {
        query: original.trim(), attributes: [], exclusions: [], bannedWords: [],
        budget: null, sort: null, waived: [], ignored: [], conflicts: [], terms: [],
        retraction: null, superseded: []
      }
    };
    for (const pass of PASSES) pass.run(ctx);
    ctx.u.claims = ctx.claims;
    return ctx.u;
  }

  function matchFacetName(text) {
    const t = text.trim();
    for (const f of FACETS) {
      if (t === f || t === FACET_LABEL[f] || t === f + "s") return f;
    }
    if (/^(kind|type|category|style)$/.test(t) && FACETS.includes("category")) return "category";
    if (/^(price|budget|cost)$/.test(t)) return "price";
    if (/^(brand|label|make)$/.test(t)) return "brand";
    return null;
  }

  function cutAtConjunction(phrase) {
    const cut = phrase.search(/\s+(?:and|or|but|plus|with|nor)\s+/);
    return (cut > 0 ? phrase.slice(0, cut) : phrase).trim();
  }

  // Three passes, deliberately. A single pass sorted by length lets a long
  // value at the tail beat a short value at the head: "wool and no acrylic"
  // would come back as acrylic. The head is what the shopper refused.
  function matchSurface(phrase) {
    const p = phrase.trim();
    for (const e of SURFACE_LIST) if (p === e.form) return out(e);
    for (const e of SURFACE_LIST) if (p.startsWith(e.form + " ")) return out(e);
    for (const e of SURFACE_LIST) if (p.endsWith(" " + e.form)) return out(e);
    return null;
    function out(e) { return { facet: e.facet, value: e.value, matched: e.form }; }
  }

  function matchBrand(phrase) {
    const p = phrase.trim();
    for (const b of BRANDS) {
      const lb = b.toLowerCase();
      if (p === lb || p.startsWith(lb)) return b;
    }
    return null;
  }
  return { parse, PASSES, matchSurface, matchBrand, matchFacetName, cutAtConjunction };
});
