#!/usr/bin/env python3
"""Build a local cache of wger.de's exercise name/id/muscle-group list.

wger's live search endpoint (/api/v2/exercise/search/) is gone (404, confirmed
2026-09-08), and the replacement list endpoint's `search=` param is a silent
no-op that returns the whole table unfiltered. Rather than keep hitting wger's
API on every unmatched exercise name with only an exact-match fallback, this
script pulls the whole exercise list once (900 base exercises, ~3365 English
name translations/aliases across them) and bakes it into wger_exercises.json,
bundled with the app like foods.json. The app then matches typed names against
this local list (exact and substring), which needs no live API round trip and
works for far more typed variants than an exact hit against wger's live API.

Usage: python3 scripts/build_wger_cache.py
Output: wger_exercises.json in the repo root, one entry per translation:
  {"name": "...", "category": "Chest", "muscle": "Chest/Triceps"} (muscle may
  be null if wger has no category/secondary-muscle data for that exercise).

Re-run this occasionally to pick up new exercises wger adds; it's a static
snapshot, not live data, so nothing breaks between runs.
"""
import json
import time
import urllib.request

BASE = "https://wger.de/api/v2"


def get_all(path, params):
    results = []
    url = f"{BASE}/{path}/?{params}&limit=200&format=json"
    while url:
        with urllib.request.urlopen(url) as resp:
            data = json.load(resp)
        results.extend(data["results"])
        url = data.get("next")
        time.sleep(0.1)  # be polite, this is a free public API
    return results


def main():
    print("Fetching categories...")
    categories = {c["id"]: c["name"] for c in get_all("exercisecategory", "")}

    print("Fetching muscles...")
    muscles = {m["id"]: (m.get("name_en") or m["name"]) for m in get_all("muscle", "")}

    print("Fetching base exercises (category + muscles)...")
    exercises = {}
    for ex in get_all("exercise", ""):
        primary_cat = categories.get(ex.get("category"))
        secondary_names = [muscles[m] for m in ex.get("muscles_secondary", []) if m in muscles]
        muscle = None
        if primary_cat:
            muscle = f"{primary_cat}/{'/'.join(secondary_names)}" if secondary_names else primary_cat
        exercises[ex["id"]] = {"category": primary_cat, "muscle": muscle}

    print("Fetching English name translations (this is the big one, ~3365 rows)...")
    translations = get_all("exercise-translation", "language=2")

    out = []
    seen = set()
    for t in translations:
        name = (t.get("name") or "").strip()
        ex_id = t.get("exercise")
        if not name or ex_id not in exercises:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        info = exercises[ex_id]
        out.append({"name": name, "category": info["category"], "muscle": info["muscle"]})

    out.sort(key=lambda e: e["name"].lower())

    with open("wger_exercises.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))

    print(f"Wrote {len(out)} unique exercise names to wger_exercises.json")


if __name__ == "__main__":
    main()
