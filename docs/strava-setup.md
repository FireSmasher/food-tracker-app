# Strava setup (one-time, has to be done by Edwin)

`scripts/sync_strava.py` pulls your Strava activities into Supabase (`strava_activities`
table), so a Nippard/Sevro session can see them via `query-logs.py`. Nothing auto-runs it
yet -- run it by hand, or set up your own launchd job once you trust it.

This needs a Strava API app and an OAuth authorization, both of which require your own
Strava login -- Claude can't do this part, only document it.

## 1. Register a Strava API app

1. Go to https://www.strava.com/settings/api (log in first).
2. Fill in an app name (e.g. "Saulog OS sync"), category, and for "Authorization Callback
   Domain" put `localhost` (you won't actually run a server there, it's just required).
3. Save. You'll get a **Client ID** and **Client Secret** -- copy both.

## 2. Authorize it once, get a code

Paste this into your browser, replacing `YOUR_CLIENT_ID`:

```
https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all
```

Log in, approve. It'll redirect to a `localhost` URL that fails to load (expected, there's
no server there) -- but the URL in your browser's address bar now has `?code=XXXX` in it.
Copy that `code` value.

## 3. Exchange the code for a refresh token

Run this in Terminal, filling in your client ID, secret, and the code from step 2:

```bash
curl -s -X POST https://www.strava.com/oauth/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d code=YOUR_CODE \
  -d grant_type=authorization_code
```

The response is JSON with a `refresh_token` field -- that's the long-lived credential the
sync script uses. Copy it.

## 4. Add everything to your local service config

Edit `~/.saulog-os-service.json` (the same file `query-logs.py` and `push-targets.py`
already use) and add these three keys alongside what's already there:

```json
{
  "supabase_url": "...",
  "service_role_key": "...",
  "user_id": "...",
  "strava_client_id": "YOUR_CLIENT_ID",
  "strava_client_secret": "YOUR_CLIENT_SECRET",
  "strava_refresh_token": "THE_REFRESH_TOKEN_FROM_STEP_3"
}
```

Claude never reads this file's actual values, same rule as everywhere else in this project.

## 5. Run it

```bash
python3 scripts/sync_strava.py
```

Strava rotates the refresh token on every use. If the script prints a NOTE with a new
refresh_token, update `strava_refresh_token` in the config file to that value before the
next run, or it'll fail.

## Note on automating it

Strava's free API rate limit is 200 requests/15min, 2000/day -- a daily run is nowhere near
that. If you want it automatic, that's a launchd job like the ones Sevro already runs
(`~/Documents/claude/Sevro/launchd/*.plist`) -- ask for that specifically once you've
confirmed a manual run works.
