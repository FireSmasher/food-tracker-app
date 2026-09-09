#!/usr/bin/env python3
"""Pull recent Strava activities into Supabase (strava_activities table).

Not run automatically by anything -- run it by hand or wire it into a launchd/cron job
yourself once you trust it. See docs/strava-setup.md for the one-time setup (registering a
Strava API app, getting a refresh token) that has to happen before this can run at all.

Usage:
    python3 sync_strava.py                  # last 30 days
    python3 sync_strava.py --days 90

Credentials come from ~/.saulog-os-service.json (the same file query-logs.py and
push-targets.py use), which Edwin creates and edits himself. Needs these keys added to it:
    strava_client_id, strava_client_secret, strava_refresh_token
alongside the existing supabase_url, service_role_key, user_id.
"""
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path

CONFIG_PATH = Path.home() / ".saulog-os-service.json"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities"


def load_config():
    if not CONFIG_PATH.exists():
        sys.exit(f"No config at {CONFIG_PATH}. See docs/strava-setup.md.")
    cfg = json.loads(CONFIG_PATH.read_text())
    required = ["supabase_url", "service_role_key", "user_id",
                "strava_client_id", "strava_client_secret", "strava_refresh_token"]
    missing = [k for k in required if not cfg.get(k)]
    if missing:
        sys.exit(f"{CONFIG_PATH} is missing: {', '.join(missing)}. See docs/strava-setup.md.")
    return cfg


def refresh_access_token(cfg):
    body = json.dumps({
        "client_id": cfg["strava_client_id"],
        "client_secret": cfg["strava_client_secret"],
        "refresh_token": cfg["strava_refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(STRAVA_TOKEN_URL, data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Strava token refresh failed: {e.code} {e.read().decode(errors='replace')}")
    # Strava rotates the refresh token on each use -- if it changed, tell the caller to save
    # the new one, otherwise the next run fails.
    if data.get("refresh_token") and data["refresh_token"] != cfg["strava_refresh_token"]:
        print(f"NOTE: Strava issued a new refresh_token. Update {CONFIG_PATH}'s "
              f"strava_refresh_token to: {data['refresh_token']}", file=sys.stderr)
    return data["access_token"]


def fetch_activities(access_token, since_days):
    after = int((datetime.now() - timedelta(days=since_days)).timestamp())
    activities = []
    page = 1
    while True:
        url = f"{STRAVA_ACTIVITIES_URL}?after={after}&per_page=100&page={page}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                batch = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            sys.exit(f"Strava activities fetch failed: {e.code} {e.read().decode(errors='replace')}")
        if not batch:
            break
        activities.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.3)
    return activities


def to_row(a, user_id):
    return {
        "user_id": user_id,
        "strava_id": a["id"],
        "date": a["start_date_local"][:10],
        "name": a.get("name"),
        "type": a.get("type"),
        "distance_km": round(a.get("distance", 0) / 1000, 2),
        "moving_time_min": round(a.get("moving_time", 0) / 60, 1),
        "elevation_m": a.get("total_elevation_gain"),
        "avg_hr": a.get("average_heartrate"),
    }


def upsert_rows(cfg, rows):
    if not rows:
        return
    url = f"{cfg['supabase_url'].rstrip('/')}/rest/v1/strava_activities?on_conflict=user_id,strava_id"
    req = urllib.request.Request(url, data=json.dumps(rows).encode(), method="POST", headers={
        "apikey": cfg["service_role_key"],
        "Authorization": f"Bearer {cfg['service_role_key']}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase upsert failed: {e.code} {e.read().decode(errors='replace')}")


def main():
    days = 30
    if "--days" in sys.argv:
        days = int(sys.argv[sys.argv.index("--days") + 1])

    cfg = load_config()
    access_token = refresh_access_token(cfg)
    activities = fetch_activities(access_token, days)
    rows = [to_row(a, cfg["user_id"]) for a in activities]
    upsert_rows(cfg, rows)
    print(f"Synced {len(rows)} Strava activities from the last {days} days.")


if __name__ == "__main__":
    main()
