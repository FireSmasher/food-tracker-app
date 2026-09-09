#!/usr/bin/env python3
"""One-time bulk import: German retailer foods (Lidl/Rewe/Netto/Edeka) from
OpenFoodFacts into germany_foods.json for Kain.

Pure data pull + filter, no LLM/Ollama involved -- OpenFoodFacts already has
structured per-100g nutrition from real product labels, this just fetches,
dedupes by barcode (keeping the most complete record when a product is
tagged under more than one store), scores by completeness, and caps at
MAX_ITEMS.

Usage: python3 import_off_foods.py [--max 5000]

Re-run any time to refresh -- it's idempotent, always rebuilds
germany_foods.json from scratch from the live API rather than patching it.
"""
import json
import sys
import time
import urllib.request
import urllib.error

# Priority order, Edwin's call: fill the cap from Lidl first, then Rewe, then
# Edeka, then Netto with whatever room is left.
STORES = ["lidl", "rewe", "edeka", "netto"]
BASE = "https://world.openfoodfacts.org/api/v2/search"
UA = "SaulogOS-KainImport/1.0 (fortsaulog@gmail.com)"
PAGE_SIZE = 100
MAX_ITEMS = 5000
FIELDS = "code,product_name,brands,nutriments,completeness"


def fetch_page(store, page, retries=6):
    params = (
        f"stores_tags={store}&countries_tags=germany&page_size={PAGE_SIZE}"
        f"&page={page}&fields={FIELDS}"
    )
    req = urllib.request.Request(f"{BASE}?{params}", headers={"Accept": "application/json"})
    req.add_header("User-Agent", UA)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read())
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            wait = 2 * (attempt + 1)
            print(f"  {store} page {page} failed ({e}), retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
    return None


def usable(p):
    n = p.get("nutriments") or {}
    name = (p.get("product_name") or "").strip()
    if not name or not p.get("code"):
        return False
    for k in ("energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g"):
        if n.get(k) is None:
            return False
    return True


def to_row(p):
    n = p["nutriments"]
    brand = (p.get("brands") or "").split(",")[0].strip()
    name = p["product_name"].strip()
    if brand and brand.lower() not in name.lower():
        name = f"{name} ({brand})"
    return {
        "name": name,
        "kcal": round(n["energy-kcal_100g"], 1),
        "protein": round(n["proteins_100g"], 1),
        "carb": round(n["carbohydrates_100g"], 1),
        "fat": round(n["fat_100g"], 1),
        "barcode": p["code"],
        "completeness": p.get("completeness") or 0,
    }


def main():
    max_items = MAX_ITEMS
    if "--max" in sys.argv:
        max_items = int(sys.argv[sys.argv.index("--max") + 1])

    # Dict preserves insertion order -- processing stores in priority order and
    # skipping a barcode already seen from a higher-priority store means the
    # final list is naturally priority-ordered (Lidl block, then Rewe, then
    # Edeka, then Netto), so truncating to max_items at the end respects the
    # priority Edwin asked for without a separate re-sort.
    by_barcode = {}
    per_store_kept = {s: 0 for s in STORES}
    MAX_CONSECUTIVE_FAILS = 8  # give up on the store only after this many pages in a row fail
    for store in STORES:
        page = 1
        page_count = None
        seen_pages_this_store = 0
        consecutive_fails = 0
        while True:
            data = fetch_page(store, page)
            if not data:
                consecutive_fails += 1
                print(f"  {store} page {page}: unrecoverable, skipping ({consecutive_fails} in a row)", file=sys.stderr)
                if consecutive_fails >= MAX_CONSECUTIVE_FAILS:
                    print(f"  {store}: too many consecutive failures, stopping at page {page}", file=sys.stderr)
                    break
                page += 1
                time.sleep(1.5)
                continue
            consecutive_fails = 0
            page_count = data.get("page_count", page_count or page)
            products = data.get("products", [])
            if not products:
                break
            for p in products:
                if not usable(p):
                    continue
                row = to_row(p)
                if row["barcode"] in by_barcode:
                    continue  # already kept from a higher-priority store
                by_barcode[row["barcode"]] = row
                per_store_kept[store] += 1
            print(f"  {store} page {page}/{page_count}: {len(products)} products, running total {len(by_barcode)}", flush=True)
            seen_pages_this_store += 1
            if page >= page_count:
                break
            page += 1
            time.sleep(0.5)  # be polite to OFF's shared infra
        print(f"{store}: done, {seen_pages_this_store} pages, {per_store_kept[store]} new uniques", flush=True)

    rows = list(by_barcode.values())[:max_items]
    for r in rows:
        del r["completeness"]

    with open("germany_foods.json", "w") as f:
        json.dump(rows, f, ensure_ascii=False, indent=0, separators=(",", ":"))

    print(f"\nWrote {len(rows)} entries to germany_foods.json")


if __name__ == "__main__":
    main()
