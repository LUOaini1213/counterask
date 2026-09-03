/* Vocabulary — every surface form the parser knows and every pattern it
   claims. Pure data: nothing here reads the catalog or a sentence. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory;
  else (root.CounteraskParts = root.CounteraskParts || {})["vocabulary"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function (meta) {
  "use strict";
  // A catalog may bring its own facets, labels and surface forms (a real one
  // does — the extractor knows what listings actually say). Without them the
  // hand-written defaults below apply.

  const FACETS = (meta && meta.facets) || ["material", "closure", "occasion", "feature", "fit"];

  const FACET_LABEL = (meta && meta.labels) || {
    material: "material", closure: "closure", occasion: "what it's for",
    feature: "feature", fit: "fit"
  };

  // Surface forms a shopper actually says -> the value the catalog records.
  // This is the only vocabulary in the system; everything else is structural.
  const SURFACE = (meta && meta.surface) || {
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
    "but", "so", "very", "quite", "would", "like", "am", "was", "not", "no",
    // function verbs and pronouns — language, not product words
    "could", "should", "can", "need", "needs", "want", "wants", "use", "get", "find",
    "have", "has", "had", "after", "hunting", "please", "something", "anything",
    "you", "your", "we", "our", "they", "them", "he", "she", "his", "her", "it's"
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
  return { FACETS, FACET_LABEL, SURFACE, SURFACE_LIST, FILLER, STOPWORDS, NEVER_BANNED, REFUSAL_PATTERNS, WAIVE_PATTERNS, RESET_PATTERNS, REPLACE_PATTERNS, SUPERSEDE_PATTERNS };
});
