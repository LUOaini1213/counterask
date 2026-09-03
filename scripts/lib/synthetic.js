/* Catalog builder — deterministic, seeded. Produces the product records the
   engine reasons over. Attributes are multi-valued on purpose (a shoe is both
   athletic and casual) and unevenly recorded on purpose (fit is rare), because
   both facts are what the stopping policy has to survive. */
(function (root) {
  "use strict";

  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  const BRANDS = [
    "Ridgeline", "Northmoor", "Ashford", "Cole & Vane", "Brackett", "Tallow",
    "Gordon Fell", "Ninefold", "Halstead", "Ironwood", "Pike & Sons", "Verity",
    "Marlow", "Cobble Row", "Sundry", "Fenwick", "Draper Lane", "Ossett"
  ];

  // Each family: the noun as it appears in titles, plausible attribute values
  // with weights, price band, and how often each facet is recorded at all.
  const FAMILIES = [
    { noun: "Belt", n: 96, price: [15, 70],
      material: [["leather", 6], ["nylon", 2], ["canvas", 1], ["suede", 1], ["polyester", 1]],
      closure: [["buckle", 6], ["snap", 2], ["pull-on", 1]],
      occasion: [["casual", 4], ["formal", 3], ["work", 1]],
      mods: ["Reversible", "Braided", "Dress", "Woven", "Full-Grain", "Tactical", "Everyday"] },

    { noun: "Running Shoe", n: 108, price: [45, 160],
      material: [["mesh", 6], ["synthetic", 3], ["knit", 2]],
      closure: [["lace-up", 8], ["slip-on", 1]],
      occasion: [["athletic", 8], ["casual", 3]],
      feature: [["breathable", 3], ["cushioned", 3], ["lightweight", 2]],
      mods: ["Trail", "Road", "Marathon", "Everyday", "Stability", "Neutral"] },

    { noun: "Hiking Boot", n: 74, price: [60, 220],
      material: [["leather", 5], ["suede", 3], ["nylon", 2], ["mesh", 2]],
      closure: [["lace-up", 8], ["zip", 1], ["pull-on", 1]],
      occasion: [["outdoor", 8], ["casual", 2], ["work", 2]],
      feature: [["water resistant", 5], ["insulated", 2], ["lightweight", 2]],
      mods: ["Waterproof", "Mid", "Low", "Backcountry", "All-Terrain", "Insulated"] },

    { noun: "Sneaker", n: 92, price: [35, 130],
      material: [["canvas", 3], ["leather", 3], ["suede", 2], ["mesh", 2]],
      closure: [["lace-up", 6], ["slip-on", 3], ["velcro", 1]],
      occasion: [["casual", 8], ["athletic", 3]],
      mods: ["Court", "Low-Top", "High-Top", "Retro", "Canvas", "Everyday"] },

    { noun: "Dress Shoe", n: 58, price: [55, 240],
      material: [["leather", 8], ["suede", 2]],
      closure: [["lace-up", 5], ["slip-on", 3], ["buckle", 1]],
      occasion: [["formal", 8], ["work", 3]],
      mods: ["Oxford", "Derby", "Loafer", "Monk", "Cap-Toe", "Wingtip"] },

    { noun: "Wallet", n: 88, price: [12, 90],
      material: [["leather", 7], ["nylon", 2], ["canvas", 1], ["polyester", 1]],
      occasion: [["casual", 4], ["formal", 2], ["work", 1]],
      feature: [["slim", 4], ["RFID blocking", 3]],
      mods: ["Bifold", "Trifold", "Money Clip", "Card", "Slim", "Travel"] },

    { noun: "Sweater", n: 84, price: [30, 180],
      material: [["wool", 5], ["cotton", 4], ["cashmere", 2], ["acrylic", 3]],
      closure: [["pull-on", 6], ["zip", 2], ["button", 1]],
      occasion: [["casual", 5], ["formal", 2], ["work", 2]],
      mods: ["Crewneck", "V-Neck", "Cable-Knit", "Merino", "Quarter-Zip", "Shawl"] },

    { noun: "Shirt", n: 112, price: [20, 110],
      material: [["cotton", 7], ["linen", 2], ["polyester", 2], ["flannel", 2]],
      closure: [["button", 8], ["pull-on", 1]],
      occasion: [["formal", 4], ["casual", 5], ["work", 3]],
      mods: ["Oxford", "Poplin", "Flannel", "Short-Sleeve", "Slim", "Chambray"] },

    { noun: "Jacket", n: 96, price: [50, 320],
      material: [["nylon", 4], ["leather", 3], ["denim", 2], ["wool", 2], ["polyester", 3]],
      closure: [["zip", 6], ["button", 2], ["snap", 2]],
      occasion: [["outdoor", 4], ["casual", 5], ["formal", 2], ["work", 2]],
      feature: [["water resistant", 4], ["insulated", 3], ["packable", 2]],
      mods: ["Bomber", "Field", "Puffer", "Rain", "Trucker", "Windbreaker"] },

    { noun: "Chino", n: 62, price: [25, 95],
      material: [["cotton", 7], ["polyester", 2]],
      closure: [["button", 6], ["zip", 3]],
      occasion: [["casual", 5], ["work", 4], ["formal", 2]],
      mods: ["Slim", "Straight", "Stretch", "Tapered", "Classic"] },

    { noun: "Sock", n: 78, price: [8, 40],
      material: [["cotton", 5], ["wool", 4], ["polyester", 3], ["merino", 2]],
      occasion: [["athletic", 4], ["casual", 4], ["formal", 2], ["outdoor", 3]],
      feature: [["cushioned", 3], ["moisture wicking", 3]],
      mods: ["No-Show", "Crew", "Ankle", "Boot", "Dress", "Hiking"] },

    { noun: "Backpack", n: 70, price: [30, 200],
      material: [["nylon", 5], ["canvas", 3], ["leather", 2], ["polyester", 3]],
      closure: [["zip", 7], ["buckle", 2]],
      occasion: [["outdoor", 4], ["work", 4], ["casual", 3]],
      feature: [["water resistant", 4], ["laptop sleeve", 3]],
      mods: ["Daypack", "Commuter", "Rolltop", "Travel", "Trail"] },

    { noun: "Watch", n: 54, price: [40, 400],
      material: [["leather", 4], ["stainless steel", 5], ["nylon", 2], ["silicone", 2]],
      occasion: [["formal", 4], ["casual", 4], ["outdoor", 2]],
      feature: [["water resistant", 5], ["chronograph", 2]],
      mods: ["Field", "Dive", "Dress", "Automatic", "Quartz", "38mm", "41mm", "44mm"] },

    { noun: "Glove", n: 44, price: [12, 90],
      material: [["leather", 4], ["wool", 3], ["polyester", 3], ["nylon", 2]],
      occasion: [["outdoor", 5], ["casual", 3], ["work", 2]],
      feature: [["insulated", 4], ["touchscreen", 3], ["water resistant", 2]],
      mods: ["Winter", "Work", "Liner", "Ski", "Driving"] },

    { noun: "Cap", n: 48, price: [10, 55],
      material: [["cotton", 5], ["wool", 2], ["polyester", 3], ["canvas", 2]],
      closure: [["snap", 4], ["buckle", 2], ["pull-on", 2]],
      occasion: [["casual", 6], ["outdoor", 3], ["athletic", 2]],
      mods: ["Baseball", "Trucker", "Five-Panel", "Dad", "Camp"] },

    { noun: "Tie", n: 40, price: [12, 95],
      material: [["silk", 6], ["wool", 2], ["cotton", 2], ["polyester", 2]],
      occasion: [["formal", 8], ["work", 3]],
      mods: ["Knit", "Grenadine", "Striped", "Solid", "Slim"] }
  ];

  // How often each facet is recorded when the family lists it at all. `fit` is
  // deliberately near-absent: it is the attribute a naive gain calculation
  // falls in love with.
  const COVERAGE = { material: 0.86, closure: 0.62, occasion: 0.80, feature: 0.34, fit: 0.06 };
  const FIT_VALUES = [["slim", 4], ["regular", 5], ["relaxed", 2]];

  function pick(list, r) {
    const total = list.reduce((a, x) => a + x[1], 0);
    let n = r() * total;
    for (const [v, w] of list) { n -= w; if (n <= 0) return v; }
    return list[list.length - 1][0];
  }

  function pickSome(list, r, maxExtra) {
    const out = [pick(list, r)];
    let extra = 0;
    while (extra < maxExtra && r() < 0.35) {
      const v = pick(list, r);
      if (!out.includes(v)) out.push(v);
      extra++;
    }
    return out;
  }

  function build() {
    const r = rng(20260903);
    const products = [];
    let id = 0;

    for (const fam of FAMILIES) {
      for (let i = 0; i < fam.n; i++) {
        const brand = BRANDS[Math.floor(r() * BRANDS.length)];
        const mod = fam.mods[Math.floor(r() * fam.mods.length)];
        const second = r() < 0.45 ? fam.mods[Math.floor(r() * fam.mods.length)] : null;
        const attrs = {};

        for (const facet of ["material", "closure", "occasion", "feature"]) {
          if (!fam[facet]) continue;
          if (r() > COVERAGE[facet]) continue;
          attrs[facet] = pickSome(fam[facet], r, facet === "occasion" ? 2 : 1);
        }
        if (r() < COVERAGE.fit) attrs.fit = [pick(FIT_VALUES, r)];

        // Title carries the brand, one or two modifiers, sometimes a recorded
        // material — so title words and recorded attributes overlap but never
        // line up perfectly, which is the case the parser has to handle.
        const parts = [brand];
        if (second && second !== mod) parts.push(second);
        parts.push(mod);
        if (attrs.material && r() < 0.4) {
          const m = attrs.material[0];
          parts.push(m.charAt(0).toUpperCase() + m.slice(1));
        }
        parts.push(fam.noun);
        const title = parts.join(" ");

        const [lo, hi] = fam.price;
        const priced = r() < 0.62;
        const price = priced ? Math.round((lo + r() * (hi - lo)) * 2) / 2 : null;

        // Demand proxied by review volume, log-scaled — a frozen catalog has
        // no click log.
        const reviews = Math.floor(Math.pow(r(), 2.4) * 4200) + 1;
        const rating = Math.round((3.1 + Math.pow(r(), 0.6) * 1.8) * 10) / 10;

        products.push({
          id: "p" + (++id),
          title,
          brand,
          family: fam.noun,
          attrs,
          price,
          reviews,
          rating: Math.min(rating, 5)
        });
      }
    }
    return products;
  }

  const CATALOG = build();
  if (typeof module !== "undefined" && module.exports) module.exports = { CATALOG };
  else root.CATALOG = CATALOG;
})(typeof window !== "undefined" ? window : globalThis);
