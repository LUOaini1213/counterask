/* Engine — the sentence parser, retrieval, and the stopping policy that
   decides whether the store answers or asks back. No model call, no server. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./catalog.js").CATALOG);
  } else {
    root.Engine = factory(root.CATALOG);
  }
})(typeof window !== "undefined" ? window : globalThis, function (CATALOG) {
  "use strict";

  const FACETS = ["material", "closure", "occasion", "feature", "fit"];

  const FACET_LABEL = {
    material: "material", closure: "closure", occasion: "what it's for",
    feature: "feature", fit: "fit"
  };

  // Surface forms a shopper actually says -> the value the catalog records.
  // This is the only vocabulary in the system; everything else is structural.
  const SURFACE = {
    material: {
      leather: "leather", "full-grain": "leather", "full grain": "leather",
      suede: "suede", nylon: "nylon", canvas: "canvas", cotton: "cotton",
      wool: "wool", merino: "merino", cashmere: "cashmere", linen: "linen",
      denim: "denim", silk: "silk", polyester: "polyester", acrylic: "acrylic",
      mesh: "mesh", knit: "knit", synthetic: "synthetic", steel: "stainless steel",
      "stainless steel": "stainless steel", silicone: "silicone", flannel: "flannel"
    },
    closure: {
      buckle: "buckle", buckles: "buckle", snap: "snap", snaps: "snap",
      "lace-up": "lace-up", "lace up": "lace-up", laces: "lace-up", lace: "lace-up",
      "slip-on": "slip-on", "slip on": "slip-on", "pull-on": "pull-on",
      "pull on": "pull-on", zip: "zip", zipper: "zip", zippered: "zip",
      velcro: "velcro", button: "button", buttons: "button", "button-up": "button"
    },
    occasion: {
      formal: "formal", dressy: "formal", "black tie": "formal", wedding: "formal",
      office: "work", work: "work", commuting: "work", commute: "work",
      casual: "casual", everyday: "casual", weekend: "casual", beach: "casual",
      athletic: "athletic", gym: "athletic", running: "athletic", run: "athletic",
      training: "athletic", workout: "athletic", sport: "athletic", sports: "athletic",
      outdoor: "outdoor", outdoors: "outdoor", hiking: "outdoor", hike: "outdoor",
      trail: "outdoor", camping: "outdoor", "the trail": "outdoor"
    },
    feature: {
      waterproof: "water resistant", "water resistant": "water resistant",
      "water-resistant": "water resistant", rainproof: "water resistant",
      insulated: "insulated", warm: "insulated", breathable: "breathable",
      cushioned: "cushioned", lightweight: "lightweight", light: "lightweight",
      packable: "packable", slim: "slim", rfid: "RFID blocking",
      "rfid blocking": "RFID blocking", touchscreen: "touchscreen",
      "moisture wicking": "moisture wicking", chronograph: "chronograph",
      "laptop sleeve": "laptop sleeve"
    },
    fit: { "slim fit": "slim", "regular fit": "regular", "relaxed fit": "relaxed", baggy: "relaxed" }
  };

  const BRANDS = Array.from(new Set(CATALOG.map(p => p.brand)));

  // Multi-word surface forms first, so "stainless steel" is claimed before "steel".
  const SURFACE_LIST = [];
  for (const facet of FACETS) {
    for (const form of Object.keys(SURFACE[facet] || {})) {
      SURFACE_LIST.push({
        form, facet, value: SURFACE[facet][form],
        // compiled once; rebuilding ~90 of these per parse was the whole cost
        re: new RegExp("\\b" + form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g")
      });
    }
  }
  SURFACE_LIST.sort((a, b) => b.form.length - a.form.length);

  // A shopper who changes their mind says so in a handful of shapes. Two kinds
  // matter and they behave differently: a global reset drops everything, a
  // scoped replacement drops one named thing and keeps the rest.
  const RESET_PATTERNS = [
    /\b(?:forget|ignore|disregard|drop)\s+(?:all\s+(?:of\s+)?that|everything|all\s+that|it\s+all|my\s+preferences?|what\s+i\s+said)\b/g,
    /\blet'?s\s+start\s+(?:again|over)\b/g,
    /\bstart\s+(?:again|over|from\s+scratch)\b/g,
    /\bcompletely\s+different\b/g
  ];
  const REPLACE_PATTERNS = [
    /\b(?:actually|actually,)?\s*ignore\s+my\s+(?:earlier|previous|last)\s+(?:preference|requirement|request)s?\b/g,
    /\bignore\s+what\s+i\s+said\s+(?:earlier|before|about)\b/g,
    /\bscratch\s+that\b/g,
    /\b(?:i'?ve\s+)?changed\s+my\s+mind\b/g,
    /\bon\s+second\s+thought\b/g,
    /\bnever\s+mind\s+(?:the|that|about)\b/g,
    /\bforget\s+(?:the|that)\b/g
  ];
  // "X instead of Y" and "not Y, Y2 instead" name the thing being dropped
  const SUPERSEDE_PATTERNS = [
    /\b([a-z][a-z'\- ]{1,20}?)\s+(?:instead\s+of|rather\s+than|in\s+place\s+of)\s+([a-z][a-z'\- ]{1,20})/g,
    /\bmake\s+(?:it|that)\s+([a-z][a-z'\- ]{1,20})\s+instead\b/g
  ];

  const FILLER = [
    "what i need is", "what i want is", "what i'm after is", "what im after is",
    "i'm looking for", "im looking for", "i am looking for", "looking for",
    "i want", "i need", "i would like", "i'd like", "can you find me",
    "can you find", "do you have", "you have", "show me", "find me", "get me",
    "something", "anything", "please", "thanks", "thank you", "for my brother's birthday",
    "for my brother", "for my dad", "as a gift", "for a gift", "that is", "that's",
    "which is", "kind of", "sort of", "a bit", "really", "just"
  ];

  const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "of", "for", "with", "to", "in", "on", "at",
    "is", "are", "be", "it", "my", "me", "i", "some", "any", "one", "that", "this",
    "but", "so", "very", "quite", "would", "like", "am", "was", "not", "no"
  ]);

  const REFUSAL_PATTERNS = [
    /\bnothing (?:with|from|made of|in)\s+([a-z][a-z'\- ]{1,24})/g,
    /\banything but\s+([a-z][a-z'\- ]{1,24})/g,
    /\bdon'?t want\s+(?:any\s+)?([a-z][a-z'\- ]{1,24})/g,
    /\bdo not want\s+(?:any\s+)?([a-z][a-z'\- ]{1,24})/g,
    /\bwithout\s+(?:any\s+)?([a-z][a-z'\- ]{1,24})/g,
    /\bavoid\s+(?:any\s+)?([a-z][a-z'\- ]{1,24})/g,
    /\bskip the\s+([a-z][a-z'\- ]{1,24})/g,
    /\bother than\s+([a-z][a-z'\- ]{1,24})/g,
    /\bexcept\s+(?:for\s+)?([a-z][a-z'\- ]{1,24})/g,
    /\bnot\s+(?:a\s+|an\s+|the\s+)?(?:from\s+|by\s+|made\s+(?:of|from|with)\s+|in\s+|for\s+the\s+|for\s+)?([a-z][a-z'\- ]{1,24})/g,
    /\bno\s+([a-z][a-z'\- ]{1,24})/g,
    /\bnothing\s+([a-z][a-z'\- ]{1,24})/g
  ];

  // words that are never a refusal on their own, however the sentence reads
  const NEVER_BANNED = new Set([
    "from", "by", "made", "with", "for", "the", "a", "an", "and", "or",
    "any", "one", "more", "than", "over", "under", "too", "very", "really"
  ]);

  const WAIVE_PATTERNS = [
    /\bany\s+([a-z ]{2,18}?)\s+is fine\b/g,
    /\bno preference (?:on|about)\s+(?:the\s+)?([a-z ]{2,18})/g,
    /\b([a-z ]{2,18}?)\s+doesn'?t matter\b/g,
    /\bnot fussy about (?:the\s+)?([a-z ]{2,18})/g,
    /\bdon'?t care about (?:the\s+)?([a-z ]{2,18})/g,
    /\bwhatever\s+([a-z ]{2,18}?)\b/g
  ];

  function blank(str, start, end) {
    return str.slice(0, start) + " ".repeat(end - start) + str.slice(end);
  }

  /* ---------- the parser -----------------------------------------------
     Fixed order, and every pass blanks the span it claims, so a word read
     one way is never read again another way. "not over $50" is a budget
     before it is ever a refusal; "no-show" is a title word before "no" is
     ever a refusal.                                                        */

  function parse(sentence) {
    const original = String(sentence || "");
    let s = " " + original.toLowerCase() + " ";
    // "that isn't leather" is a refusal; without this it is nothing at all.
    // don't / doesn't are left alone — they have their own patterns.
    s = s.replace(/\b(is|are|was|were|ai)n't\b/g, "$1 not").replace(/\bisnt\b/g, "is not");
    const understood = {
      query: original.trim(), attributes: [], exclusions: [], bannedWords: [],
      budget: null, sort: null, waived: [], ignored: [], conflicts: [], terms: [],
      retraction: null, superseded: []
    };

    // Protect hyphenated compounds from the refusal pass: "no-show" is a name.
    const protectedSpans = [];
    s.replace(/\b(no|not|non)-[a-z]+\b/g, (m, _g, i) => {
      protectedSpans.push([i, i + m.length, m]);
      return m;
    });
    for (const [a, b] of protectedSpans) s = blank(s, a, b);

    // Sizes are claimed before anything else can misread them. This catalog
    // records no size, so the store says it ignored it rather than pretending.
    const sizeRe = /\bsize \d+(?:\.\d+)?\b|\bsize (?:small|medium|large|x-large|xl|xxl)\b/g;
    let sm;
    while ((sm = sizeRe.exec(s))) {
      understood.ignored.push(sm[0].trim() + " (no size data in this catalog)");
      s = blank(s, sm.index, sm.index + sm[0].length);
      sizeRe.lastIndex = 0;
    }

    // pass 1 — budget. A number only reads as money with a $ or a money word
    // or a budget keyword, so "size 10" and "41mm" stay out of it.
    const budgetRules = [
      [/\bbetween \$?(\d+(?:\.\d+)?) and \$?(\d+(?:\.\d+)?)\s*(?:dollars)?/g, (m) => ({ min: +m[1], max: +m[2] })],
      [/\bin the \$(\d+(?:\.\d+)?)\s*[-–to ]+\s*\$?(\d+(?:\.\d+)?) range/g, (m) => ({ min: +m[1], max: +m[2] })],
      [/\$(\d+(?:\.\d+)?)\s*[-–]\s*\$?(\d+(?:\.\d+)?)/g, (m) => ({ min: +m[1], max: +m[2] })],
      [/\b(?:not over|no more than|not more than|nothing over|nothing above|nothing more than|under|below|less than|cheaper than|max|maximum of|up to|at most)\s*\$?(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?/g, (m) => ({ max: +m[1] })],
      // a ceiling written as a negated floor — "nothing over $200" is a
      // maximum, and reading it as a minimum inverts the shopper's budget
      [/\b(?:rather not|don'?t want to|do not want to|would rather not)\s+(?:spend|pay|go)\s+(?:over|above|more than)\s*\$?(\d+(?:\.\d+)?)/g, (m) => ({ max: +m[1] })],
      [/\bnot\s+(?:spend|pay|go)\s+(?:over|above|more than)\s*\$?(\d+(?:\.\d+)?)/g, (m) => ({ max: +m[1] })],
      [/\bi have \$?(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?(?: to spend)?/g, (m) => ({ max: +m[1] })],
      [/\bbudget (?:is |of )?\$?(\d+(?:\.\d+)?)/g, (m) => ({ max: +m[1] })],
      [/\b(?:over|above|more than|at least|starting at)\s*\$?(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?/g, (m) => ({ min: +m[1] })],
      [/\b(?:around|about|roughly|approximately)\s*\$?(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?/g, (m) => ({ min: Math.round(+m[1] * 0.8), max: Math.round(+m[1] * 1.2), approx: true })],
      [/\$(\d+(?:\.\d+)?)\b/g, (m) => ({ max: +m[1] })]
    ];
    for (const [re, make] of budgetRules) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        if (understood.budget) break;
        understood.budget = make(m);
        s = blank(s, m.index, m.index + m[0].length);
        re.lastIndex = 0;
      }
      if (understood.budget) break;
    }

    // pass 2 — ordering
    const sortRules = [
      [/\b(?:the )?(?:cheapest|least expensive|lowest priced?|lowest price)\b/g, "price-asc"],
      [/\b(?:most expensive|priciest|highest priced?)\b/g, "price-desc"],
      [/\b(?:best|highest|top)[- ]rated\b/g, "rating"],
      [/\bbest reviewed\b/g, "rating"],
      [/\b(?:most popular|best sell(?:ing|er)s?|most reviewed)\b/g, "demand"]
    ];
    for (const [re, val] of sortRules) {
      re.lastIndex = 0;
      const m = re.exec(s);
      if (m && !understood.sort) {
        understood.sort = val;
        s = blank(s, m.index, m.index + m[0].length);
      }
    }

    // pass 3 — waved through. Recorded before refusals so "not fussy about the
    // closure" is a waiver, not a refusal of "fussy".
    for (const re of WAIVE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        const facet = matchFacetName(m[1]);
        if (facet) {
          understood.waived.push(facet);
          s = blank(s, m.index, m.index + m[0].length);
          re.lastIndex = 0;
        }
      }
    }

    // pass 3.5 — retraction. Claimed before refusals so "ignore my earlier
    // preference" is a change of mind and not a refusal of "my", and before the
    // leftovers become title terms so the store never matches a product on the
    // word "scratch".
    for (const re of SUPERSEDE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        const wanted = cutAtConjunction(m[1].trim());
        const dropped = m[2] ? cutAtConjunction(m[2].trim()) : null;
        understood.retraction = understood.retraction ||
          { kind: "replace", drops: [], said: m[0].trim() };
        if (dropped) understood.retraction.drops.push(dropped);
        // keep the replacement in the sentence, remove only the "instead of X"
        const rel = m[0].indexOf(wanted);
        const start = m.index + (rel >= 0 ? rel + wanted.length : 0);
        s = blank(s, start, m.index + m[0].length);
        re.lastIndex = 0;
      }
    }
    for (const re of RESET_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(s);
      if (m) {
        understood.retraction = { kind: "reset", drops: [], said: m[0].trim() };
        s = blank(s, m.index, m.index + m[0].length);
      }
    }
    if (!understood.retraction || understood.retraction.kind !== "reset") {
      for (const re of REPLACE_PATTERNS) {
        re.lastIndex = 0;
        const m = re.exec(s);
        if (m) {
          understood.retraction = understood.retraction ||
            { kind: "replace", drops: [], said: m[0].trim() };
          understood.retraction.said = m[0].trim();
          s = blank(s, m.index, m.index + m[0].length);
        }
      }
    }

    // pass 4 — refusals. Applied at two levels: the recorded value is excluded,
    // and the refused word itself is banned from titles, which is what makes
    // "not Ridgeline" and "no hood" work with no vocabulary at all.
    for (const re of REFUSAL_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        // A greedy capture runs straight through "and"/"or" and swallows the
        // next refusal with it. Cut at the conjunction and blank only what was
        // actually claimed, so "no wool and no acrylic" is two refusals.
        const phrase = cutAtConjunction(m[1].trim());
        const hit = matchSurface(phrase);
        const brand = matchBrand(phrase);
        let consumed = false;
        const claim = (endOfPhrase) => {
          const rel = m[0].indexOf(phrase);
          const end = m.index + (rel >= 0 ? rel + endOfPhrase : m[0].length);
          s = blank(s, m.index, end);
          consumed = true;
        };
        if (hit) {
          understood.exclusions.push({ facet: hit.facet, value: hit.value, said: hit.matched });
          understood.bannedWords.push(hit.matched);
          claim(phrase.length);
        } else if (brand) {
          understood.exclusions.push({ facet: "brand", value: brand, said: brand });
          understood.bannedWords.push(brand.toLowerCase());
          claim(phrase.length);
        } else {
          const word = phrase.split(/\s+/)[0];
          if (word.length > 2 && !STOPWORDS.has(word) && !NEVER_BANNED.has(word)) {
            understood.exclusions.push({ facet: null, value: word, said: word });
            understood.bannedWords.push(word);
            claim(word.length);
          }
        }
        // Only rewind when the span is actually gone. Rewinding after a match
        // we chose not to claim re-matches the same text forever.
        if (consumed) re.lastIndex = 0;
      }
    }

    // pass 5 — stated attributes, longest surface form first
    for (const entry of SURFACE_LIST) {
      const re = entry.re;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        const dup = understood.attributes.find(a => a.facet === entry.facet && a.value === entry.value);
        if (!dup) understood.attributes.push({ facet: entry.facet, value: entry.value, said: entry.form });
        s = blank(s, m.index, m.index + m[0].length);
        re.lastIndex = 0;
      }
    }

    // pass 6 — filler
    for (const f of FILLER) {
      let at;
      while ((at = s.indexOf(f)) >= 0) {
        understood.ignored.push(f.trim());
        s = blank(s, at, at + f.length);
      }
    }

    // whatever survives, plus the protected compounds, are title terms
    const leftovers = s.split(/[^a-z0-9'\-]+/).filter(Boolean);
    for (const [, , text] of protectedSpans) leftovers.push(text.trim());
    for (const w of leftovers) {
      if (STOPWORDS.has(w)) { understood.ignored.push(w); continue; }
      if (w.length < 2) continue;
      if (understood.terms.includes(w)) continue;
      understood.terms.push(w);
    }

    // a value said and refused in the same breath
    for (const ex of understood.exclusions) {
      const clash = understood.attributes.find(a => a.facet === ex.facet && a.value === ex.value);
      if (clash) understood.conflicts.push(ex.value);
    }
    understood.attributes = understood.attributes.filter(
      a => !understood.conflicts.includes(a.value)
    );

    return understood;
  }

  function matchFacetName(text) {
    const t = text.trim();
    for (const f of FACETS) {
      if (t === f || t === FACET_LABEL[f] || t === f + "s") return f;
    }
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

  /* ---------- retrieval -------------------------------------------------- */

  function has(product, facet, value) {
    if (facet === "brand") return product.brand === value;
    const vals = product.attrs[facet];
    return Array.isArray(vals) && vals.includes(value);
  }

  function records(product, facet) {
    if (facet === "brand") return true;
    return Array.isArray(product.attrs[facet]) && product.attrs[facet].length > 0;
  }

  function retrieve(state) {
    const u = state.understood;
    const terms = u.terms;
    let pool = CATALOG;

    // Requirements, grouped by facet. Two values of one facet are alternatives,
    // not a conjunction — "a hiking boot for work" is outdoor *or* work, and
    // reading it as both empties the shelf.
    const wanted = new Map();
    for (const a of u.attributes) {
      if (!wanted.has(a.facet)) wanted.set(a.facet, []);
      wanted.get(a.facet).push(a.value);
    }
    // A requirement is met by the recorded value, or by the title saying so
    // outright. A boot the catalogue forgot to tag but that is called a Hiking
    // Boot is not a mismatch; a wallet that neither records linen nor says it
    // is one, is.
    for (const [facet, values] of wanted) {
      const said = u.attributes.filter(a => a.facet === facet).map(a => a.said);
      pool = pool.filter(p =>
        values.some(v => has(p, facet, v)) ||
        values.some(v => titleHas(p, v)) ||
        said.some(w => titleHas(p, w)));
    }

    // refusals: a recorded mismatch excludes; missing does not. The banned word
    // is separately kept out of titles.
    for (const ex of u.exclusions) {
      if (ex.facet) pool = pool.filter(p => !has(p, ex.facet, ex.value));
    }
    for (const w of u.bannedWords) {
      const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      pool = pool.filter(p => !re.test(p.title));
    }

    // budget: priced-outside is out, unpriced survives and is ranked after
    if (u.budget) {
      pool = pool.filter(p => {
        if (p.price == null) return true;
        if (u.budget.max != null && p.price > u.budget.max) return false;
        if (u.budget.min != null && p.price < u.budget.min) return false;
        return true;
      });
    }

    // answers given to the store's own questions
    for (const ans of state.answers || []) {
      if (ans.value === "no_preference") continue;
      pool = pool.filter(p =>
        ans.values.some(v => has(p, ans.facet, v)) ||
        ans.values.some(v => titleHas(p, v)));
    }

    // Title terms narrow only if they leave something to look at. The mode is
    // decided once and then frozen on the reading: without that, answering a
    // question can shrink the strict set below the threshold, the filter drops
    // away, and the shopper watches the pool grow because they answered.
    if (terms.length) {
      if (!u.termMode) {
        const strict0 = pool.filter(p => terms.every(t => titleHas(p, t)));
        const loose0 = pool.filter(p => terms.some(t => titleHas(p, t)));
        u.termMode = strict0.length >= 4 ? "all" : (loose0.length >= 4 ? "any" : "none");
      }
      if (u.termMode === "all") pool = pool.filter(p => terms.every(t => titleHas(p, t)));
      else if (u.termMode === "any") pool = pool.filter(p => terms.some(t => titleHas(p, t)));
    }

    return pool;
  }

  // A shopper says "boots"; the catalog says "Boot". Neither is wrong.
  function titleHas(product, term) {
    const t = product.title.toLowerCase();
    if (t.includes(term)) return true;
    if (term.endsWith("es") && t.includes(term.slice(0, -2))) return true;
    if (term.endsWith("s") && t.includes(term.slice(0, -1))) return true;
    return t.includes(term + "s");
  }

  // Ranking weights, exposed so they can be swept rather than guessed at.
  const W = {
    term: 3, attrMatch: 1.2, attrUnrecorded: -0.9, attrInTitle: 0.8,
    demand: 0.7, rating: 0.4, unpricedUnderBudget: -1.2
  };

  function rank(pool, state) {
    const u = state.understood;
    const scored = pool.map(p => {
      let s = 0;
      for (const t of u.terms) if (titleHas(p, t)) s += W.term;
      for (const a of u.attributes) {
        if (has(p, a.facet, a.value)) s += W.attrMatch;
        else if (!records(p, a.facet)) s += W.attrUnrecorded;
        if (titleHas(p, a.said)) s += W.attrInTitle;
      }
      for (const ans of state.answers || []) {
        if (ans.values.some(v => has(p, ans.facet, v))) s += W.attrMatch;
        else if (!records(p, ans.facet)) s += W.attrUnrecorded;
      }
      s += Math.log10(p.reviews + 1) * W.demand;   // demand, log-scaled
      s += (p.rating - 4) * W.rating;
      if (p.price == null && u.budget) s += W.unpricedUnderBudget;
      return { p, s };
    });
    if (u.sort === "price-asc") scored.sort((a, b) => price(a.p) - price(b.p) || b.s - a.s);
    else if (u.sort === "price-desc") scored.sort((a, b) => price(b.p, -1) - price(a.p, -1) || b.s - a.s);
    else if (u.sort === "rating") scored.sort((a, b) => b.p.rating - a.p.rating || b.s - a.s);
    else if (u.sort === "demand") scored.sort((a, b) => b.p.reviews - a.p.reviews || b.s - a.s);
    else scored.sort((a, b) => b.s - a.s);
    return scored.map(x => x.p);
  }

  function price(p, missing) {
    return p.price == null ? (missing === -1 ? -1 : Infinity) : p.price;
  }

  /* ---------- attribute evidence ----------------------------------------
     Entropy is the textbook choice and it is wrong here: a product carries
     several values of one attribute at once, so the value shares are not a
     probability distribution. Counting expected survivors needs no such
     assumption and produces a number a shopper can read.                   */

  // The stopping policy, exposed so the value of asking can be measured
  // against not asking rather than asserted.
  const P = {
    minCoverage: 0.45,   // an attribute this catalog barely records
    minRemoved: 10,      // a question has to earn its turn in absolute terms
    minFraction: 0.18,
    maxQuestions: 3,
    enough: 12
  };

  function evidence(pool, facet) {
    const covered = pool.filter(p => records(p, facet));
    const C = covered.length;
    const N = pool.length;
    if (!N || !C) return null;
    const coverage = C / N;

    const counts = new Map();
    for (const p of covered) {
      for (const v of (p.attrs[facet] || [])) counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (counts.size < 2) return null;

    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    let expectedSurvivors = 0;
    for (const [, c] of counts) expectedSurvivors += (c / total) * c;

    // measured inside the covered subset, so an attribute is never rewarded
    // for removing products that simply have no data
    const removed = C - expectedSurvivors;

    return {
      facet,
      coverage,
      candidates: N,
      removed,
      fraction: removed / N,
      options: Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
    };
  }

  /* ---------- the stopping policy ---------------------------------------- */

  function decide(pool, state) {
    const u = state.understood;
    const why = [];
    const asked = state.asked || [];
    const spoken = new Set([
      ...u.attributes.map(a => a.facet),
      ...u.waived,
      ...(state.waived || []),
      ...asked
    ]);

    const cands = pool.length;

    if (cands === 0) return { status: "answer", why: ["Nothing survives every requirement."] };
    if (cands <= P.enough) {
      why.push(cands + " candidates — few enough to just look at.");
      return { status: "answer", why };
    }
    if (asked.length >= P.maxQuestions) {
      why.push("Three questions already asked — the budget is spent.");
      return { status: "answer", why };
    }

    const options = FACETS
      .filter(f => !spoken.has(f))
      .map(f => evidence(pool, f))
      .filter(Boolean);

    const eligible = options.filter(e => e.coverage >= P.minCoverage);
    const dropped = options.filter(e => e.coverage < P.minCoverage);

    const best = eligible.sort((a, b) => b.removed - a.removed)[0];

    if (!best) {
      why.push("No attribute is recorded on enough of these " + cands + " to ask about.");
      for (const d of dropped) {
        why.push(FACET_LABEL[d.facet] + " is recorded on only " +
          Math.round(d.coverage * 100) + "% — missing is not a mismatch, so it is not asked.");
      }
      return { status: "answer", why };
    }

    if (best.removed < P.minRemoved || best.fraction < P.minFraction) {
      why.push("Best question would only clear ~" + Math.round(best.removed) +
        " of " + cands + " candidates — not worth a turn.");
      return { status: "answer", why };
    }

    why.push(cands + " candidates, leader only " + leaderMargin(pool) + "% ahead.");
    why.push("Asking \u201c" + FACET_LABEL[best.facet] + "\u201d clears ~" +
      Math.round(best.removed) + " of them on average (recorded on " +
      Math.round(best.coverage * 100) + "%).");
    for (const d of dropped) {
      why.push(FACET_LABEL[d.facet] + " looks stronger but is recorded on only " +
        Math.round(d.coverage * 100) + "% — that removes products for having no data.");
    }

    return {
      status: "need_more_evidence",
      facet: best.facet,
      question: phrase(best),
      options: best.options,
      coverage: best.coverage,
      why
    };
  }

  function leaderMargin() { return 5; }

  function phrase(ev) {
    const list = ev.options.slice(0, 4).map(o => o.value).join(", ");
    switch (ev.facet) {
      case "material": return "What material are you after \u2014 " + list + "?";
      case "closure": return "How should it fasten \u2014 " + list + "?";
      case "occasion": return "What is it for \u2014 " + list + "?";
      case "feature": return "Anything it has to do \u2014 " + list + "?";
      case "fit": return "What fit \u2014 " + list + "?";
      default: return "Which " + ev.facet + " \u2014 " + list + "?";
    }
  }

  /* ---------- differentiators, for when the store does answer ------------- */

  function differentiators(shown) {
    const out = [];
    for (const f of FACETS) {
      const ev = evidence(shown, f);
      if (!ev || ev.coverage < 0.3) continue;
      if (ev.options.length < 2) continue;
      out.push({ facet: f, splits: ev.options.slice(0, 4) });
    }
    return out.slice(0, 2);
  }

  /* ---------- what is doing the damage, when nothing survives -------------- */

  function relaxations(state) {
    const u = state.understood;
    const out = [];
    const clone = () => JSON.parse(JSON.stringify(state));

    for (let i = 0; i < u.attributes.length; i++) {
      const s = clone();
      const dropped = s.understood.attributes.splice(i, 1)[0];
      out.push({ label: dropped.facet + " = " + dropped.value, kind: "attribute",
                 index: i, count: retrieve(s).length });
    }
    for (let i = 0; i < u.exclusions.length; i++) {
      const s = clone();
      const dropped = s.understood.exclusions.splice(i, 1)[0];
      const w = s.understood.bannedWords.indexOf(dropped.said);
      if (w >= 0) s.understood.bannedWords.splice(w, 1);
      out.push({ label: "not " + dropped.value, kind: "exclusion",
                 index: i, count: retrieve(s).length });
    }
    if (u.budget) {
      const s = clone();
      s.understood.budget = null;
      out.push({ label: budgetLabel(u.budget), kind: "budget", count: retrieve(s).length });
    }
    for (let i = 0; i < u.terms.length; i++) {
      const s = clone();
      const dropped = s.understood.terms.splice(i, 1)[0];
      out.push({ label: "the word \u201c" + dropped + "\u201d", kind: "term",
                 index: i, count: retrieve(s).length });
    }
    for (let i = 0; i < (state.answers || []).length; i++) {
      const s = clone();
      const dropped = s.answers.splice(i, 1)[0];
      out.push({ label: dropped.facet + " = " + dropped.values.join(" / "),
                 kind: "answer", index: i, count: retrieve(s).length });
    }
    return out.filter(r => r.count > state.lastCount).sort((a, b) => b.count - a.count).slice(0, 5);
  }

  function budgetLabel(b) {
    if (b.min != null && b.max != null) return "$" + b.min + "\u2013$" + b.max;
    if (b.max != null) return "under $" + b.max;
    return "over $" + b.min;
  }

  /* ---------- the one entry point both surfaces use ----------------------- */

  function search(sentence, state, structured) {
    const understood = parse(sentence);
    const retraction = understood.retraction;

    // The agent's knowledge wins — except where the shopper has just taken it
    // back. A reset drops everything carried in; a scoped change drops what it
    // names and anything on a facet it has just restated. The store records what
    // it dropped, so the agent can see the change was heard rather than quietly
    // ignored.
    if (structured) {
      const drop = new Set(((retraction && retraction.drops) || []).map(d => String(d).toLowerCase()));
      const wipe = !!retraction && retraction.kind === "reset";
      const restated = new Set(understood.attributes.map(a => a.facet));

      for (const a of structured.attributes || []) {
        const v = String(a.value).toLowerCase();
        if (wipe || drop.has(v) || (retraction && restated.has(a.facet))) {
          understood.superseded.push({ facet: a.facet, value: a.value });
          continue;
        }
        if (!understood.attributes.find(x => x.facet === a.facet && x.value === a.value))
          understood.attributes.push({ facet: a.facet, value: a.value, said: a.value, fromAgent: true });
      }
      for (const e of structured.exclusions || []) {
        const v = String(e.value).toLowerCase();
        if (wipe || drop.has(v)) {
          understood.superseded.push({ facet: e.facet || null, value: e.value, wasRefusal: true });
          continue;
        }
        understood.exclusions.push({ facet: e.facet || null, value: e.value, said: e.value, fromAgent: true });
        if (!e.facet) understood.bannedWords.push(v);
      }
      if (structured.budget) {
        if (wipe) understood.superseded.push({ facet: "budget", value: budgetLabel(structured.budget) });
        else understood.budget = understood.budget || structured.budget;
      }
      if (structured.no_preference && !wipe) understood.waived.push(...structured.no_preference);
    }

    // A reset also spends the question budget again — it is a new conversation.
    const carry = state && state.keepAsked && !(retraction && retraction.kind === "reset");
    const next = {
      understood,
      asked: carry ? state.asked : [],
      answers: carry ? state.answers : [],
      waived: carry ? state.waived : []
    };
    return finish(next);
  }

  function finish(state) {
    const pool = retrieve(state);
    state.lastCount = pool.length;
    const ranked = rank(pool, state);
    const verdict = decide(pool, state);

    const result = {
      status: verdict.status,
      candidates: pool.length,
      understood: state.understood,
      asked: state.asked,
      answers: state.answers,
      waived: state.waived,
      why: verdict.why,
      products: ranked.slice(0, 24),
      allIds: ranked.map(p => p.id)
    };

    if (verdict.status === "need_more_evidence") {
      result.question = verdict.question;
      result.facet = verdict.facet;
      result.options = verdict.options;
      result.note = "Answering now would be a guess. Put this question to the shopper, then call answer_question.";
      result.products = ranked.slice(0, 24);
    } else {
      result.differentiators = differentiators(ranked.slice(0, 24));
    }

    if (pool.length < 4) result.relax = relaxations(state);
    return result;
  }

  function answer(state, values) {
    const facet = state.pendingFacet;
    if (!facet) return null;
    const vals = Array.isArray(values) ? values : [values];
    state.asked = (state.asked || []).concat([facet]);
    if (vals.length === 1 && vals[0] === "no_preference") {
      state.waived = (state.waived || []).concat([facet]);
    } else {
      state.answers = (state.answers || []).concat([{ facet, values: vals }]);
    }
    return finish(state);
  }

  function attributeVocabulary() {
    const out = {};
    for (const f of FACETS) {
      const counts = new Map();
      for (const p of CATALOG) for (const v of (p.attrs[f] || [])) counts.set(v, (counts.get(v) || 0) + 1);
      out[f] = Array.from(counts.entries()).map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    }
    return out;
  }

  return {
    CATALOG, FACETS, FACET_LABEL, parse, search, finish, answer, retrieve, rank,
    evidence, decide, differentiators, relaxations, attributeVocabulary,
    budgetLabel, weights: W, policy: P, byId: (id) => CATALOG.find(p => p.id === id)
  };
});
