#!/usr/bin/env python3
"""Turn the frozen 50,000-product Amazon catalog into a browser-sized index.

Counterask ships its whole storefront to the client: retrieval, attribute
extraction and the stopping policy all run in the tab, so the catalog has to
arrive over the wire and stay small enough to be worth waiting for.

We keep the menswear slice (9,901 products), drop everything the ranker never
reads, and pre-extract the attribute evidence the policy asks about, so the
browser does no parsing beyond JSON.parse.

    python scripts/build_catalog.py --source ../techjam-conversational-search/data/catalog.jsonl
"""

from __future__ import annotations

import argparse
import collections
import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "catalog.json"

# Attributes a shopper actually volunteers, and the surface forms they use.
# Values are matched against title + features + details, lowercased.
FACETS: dict[str, dict[str, tuple[str, ...]]] = {
    "material": {
        "leather": ("genuine leather", "full grain leather", "leather"),
        "cotton": ("100% cotton", "cotton"),
        "polyester": ("polyester",),
        "wool": ("merino wool", "wool"),
        "denim": ("denim",),
        "linen": ("linen",),
        "nylon": ("nylon",),
        "fleece": ("fleece",),
        "spandex": ("spandex", "elastane"),
        "suede": ("suede",),
    },
    "closure": {
        "buckle": ("buckle closure", "buckle"),
        "zipper": ("zipper closure", "zip fly", "zipper"),
        "button": ("button closure", "button fly", "button"),
        "lace-up": ("lace-up", "lace up"),
        "pull-on": ("pull on closure", "pull-on"),
        "hook and loop": ("hook and loop", "velcro"),
        "snap": ("snap closure",),
    },
    "sleeve": {
        "short sleeve": ("short sleeve", "short-sleeve"),
        "long sleeve": ("long sleeve", "long-sleeve"),
        "sleeveless": ("sleeveless", "tank"),
    },
    "fit": {
        "slim fit": ("slim fit",),
        "regular fit": ("regular fit", "classic fit", "traditional fit"),
        "relaxed fit": ("relaxed fit", "loose fit"),
        "big and tall": ("big & tall", "big and tall"),
    },
    "care": {
        "machine wash": ("machine wash",),
        "hand wash": ("hand wash",),
        "dry clean": ("dry clean",),
    },
    "origin": {
        "imported": ("imported",),
        "made in usa": ("made in usa", "made in the usa"),
    },
    "sole": {
        "rubber sole": ("rubber sole",),
        "synthetic sole": ("synthetic sole",),
        "leather sole": ("leather sole",),
    },
    "occasion": {
        "formal": ("formal", "dress shirt", "business"),
        "casual": ("casual",),
        "athletic": ("athletic", "running", "workout", "gym"),
        "outdoor": ("hiking", "outdoor", "work boot"),
    },
    "pocket": {
        "with pockets": ("pockets", "pocket"),
    },
    "waterproof": {
        "water resistant": ("waterproof", "water resistant", "water-resistant"),
    },
}

STOP = {
    "the", "and", "for", "with", "you", "your", "our", "this", "that", "from",
    "are", "was", "will", "can", "has", "have", "all", "any", "not", "but",
    "men", "mens", "men's", "size", "sizes", "made", "great", "perfect", "quality",
}

TOKEN = re.compile(r"[a-z0-9]+")


def tokens(text: str) -> list[str]:
    return [t for t in TOKEN.findall(text.lower()) if len(t) > 2 and t not in STOP]


def facets_for(blob: str) -> dict[str, list[str]]:
    """Attribute evidence the stopping policy can ask about and filter on."""

    found: dict[str, list[str]] = {}
    for facet, values in FACETS.items():
        hits = [name for name, forms in values.items() if any(f in blob for f in forms)]
        if hits:
            found[facet] = hits
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="path to catalog.jsonl")
    ap.add_argument("--department", default="Men", help="level-2 category to keep")
    args = ap.parse_args()

    src = Path(args.source)
    if not src.is_file():
        raise SystemExit(f"catalog not found: {src}")

    kept: list[dict] = []
    facet_counts: collections.Counter[str] = collections.Counter()

    with src.open(encoding="utf-8") as fh:
        for line in fh:
            d = json.loads(line)
            cats = d.get("categories") or []
            if len(cats) < 2 or cats[1] != args.department:
                continue

            title = (d.get("title") or "").strip()
            if not title:
                continue
            feats = [(f or "").strip() for f in (d.get("features") or [])[:6]]
            feats = [f[:80] for f in feats if len(f) > 2]
            details = d.get("details") or {}
            blob = " ".join([title, *feats, *(str(v) for v in details.values())]).lower()

            fac = facets_for(blob)
            for k in fac:
                facet_counts[k] += 1

            kept.append({
                "id": d.get("parent_asin") or "",
                "t": title[:110],
                "p": d.get("price"),
                "r": d.get("average_rating"),
                "n": d.get("rating_number") or 0,
                "b": (d.get("store") or "")[:36],
                "c": cats[2:5],
                "f": fac,
                "k": sorted(set(tokens(title)))[:24],
            })

    payload = {
        "meta": {
            "source": "Amazon Reviews 2023 (McAuley Lab, UCSD) — frozen 50,000-product TechJam catalog",
            "slice": f"level-2 category = {args.department}",
            "count": len(kept),
            "facets": list(FACETS.keys()),
        },
        "facetValues": {k: sorted(v.keys()) for k, v in FACETS.items()},
        # The wording a shopper uses is rarely the canonical value: they type
        # "waterproof", the catalog records "water resistant". Ship the surface
        # forms so the page can recognise what was already said.
        "facetForms": {
            facet: {value: list(forms) for value, forms in values.items()}
            for facet, values in FACETS.items()
        },
        "items": kept,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    OUT.write_bytes(raw)

    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  items      {len(kept)}")
    print(f"  raw        {len(raw)/1048576:.2f} MB")
    print(f"  gzip       {len(gzip.compress(raw, 9))/1048576:.2f} MB")
    print("  facet coverage:")
    for k in FACETS:
        print(f"    {k:<12} {100*facet_counts[k]/max(len(kept),1):5.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
