#!/usr/bin/env python3
"""Push updated Nippard targets into Supabase so Saulog OS reads them live.

This is the Nippard -> Kain direction of the targets sync: run it whenever Nippard's
own numbers change (e.g. after a recalibration), and every phone that's signed in
picks up the new targets next time it's online (see syncTargets() in app.js). Nothing
calls this automatically — it's on-demand, same as query-logs.py.

Usage:
    python3 push-targets.py --kcal 2300 --protein 150 --fat 70 --carb 265

Credentials come from ~/.saulog-os-service.json (see query-logs.py / HANDOFF.md,
"Setup: Supabase"), which must ALSO carry a "user_id" key — the UUID of the one
Saulog OS account, visible in the Supabase dashboard under Authentication -> Users
next to fortsaulog@gmail.com. Edwin adds this to the file himself; this script will
not create or ask for it (same credential-boundary rule as query-logs.py).

Uses the service_role key, which bypasses Row Level Security by design — supabase/
schema.sql's `targets` table has no insert/update policy for the app's own
`authenticated` role, specifically so this script is the only thing that can ever
write it.
"""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

CONFIG_PATH = Path.home() / ".saulog-os-service.json"


def load_config():
    if not CONFIG_PATH.exists():
        sys.exit(
            f"No config at {CONFIG_PATH}. Create it yourself (see HANDOFF.md, "
            f"\"Setup: Supabase\") — this script will not create or ask for the key."
        )
    cfg = json.loads(CONFIG_PATH.read_text())
    missing = [k for k in ("supabase_url", "service_role_key", "user_id") if not cfg.get(k)]
    if missing:
        sys.exit(
            f"{CONFIG_PATH} is missing: {', '.join(missing)}. user_id is the UUID from "
            f"Supabase -> Authentication -> Users (not the service_role key)."
        )
    return cfg


def parse_targets(args):
    flags = {}
    for i, a in enumerate(args):
        if a.startswith("--") and i + 1 < len(args):
            flags[a[2:]] = args[i + 1]
    out = {}
    for key in ("kcal", "protein", "fat", "carb"):
        if key not in flags:
            sys.exit(f"Missing --{key}. Usage: --kcal N --protein N --fat N --carb N")
        try:
            out[key] = float(flags[key])
        except ValueError:
            sys.exit(f"--{key} must be a number, got {flags[key]!r}")
    return out


def push_targets(cfg, targets):
    url = f"{cfg['supabase_url'].rstrip('/')}/rest/v1/targets?on_conflict=user_id"
    body = json.dumps({"user_id": cfg["user_id"], **targets}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("apikey", cfg["service_role_key"])
    req.add_header("Authorization", f"Bearer {cfg['service_role_key']}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=merge-duplicates,return=representation")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Push failed: {e.code} {e.read().decode(errors='replace')}")
    except urllib.error.URLError as e:
        sys.exit(f"Push failed (network): {e.reason}")


def main():
    cfg = load_config()
    targets = parse_targets(sys.argv[1:])
    result = push_targets(cfg, targets)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
