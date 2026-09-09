# Apple Health -> Saulog OS, via iOS Shortcuts

Safari (and any PWA installed from it) can never read HealthKit directly -- that's an iOS
platform restriction, not something fixable in this app's code. The real bridge is the
**Shortcuts app**, which *can* read Health data and make HTTP requests. This gets your
Apple Watch SE sleep, your Health app steps, and (optionally) your Health app weight into
Supabase so Kain/Buhat/Quarters see it without you typing it in twice.

This is something you build once in the Shortcuts app on your phone -- it can't be built
remotely. The steps below are exact enough to follow directly.

## What it does

One Shortcut, run manually or as an Automation (e.g. "every day at 23:00" or "when I open
Saulog OS"):
1. Reads today's step count, last night's sleep duration, and (optionally) your latest
   logged weight from Health.
2. Signs into Supabase with your email/password (same account Kain/Buhat use).
3. Upserts one row into `health_logs` for today's date with steps/sleep, and optionally
   updates `weight_logs` too.

## Step 1: build the Shortcut

Open **Shortcuts** app -> **+** (new shortcut). Add these actions in order:

1. **Get Health Sample** -> Type: *Steps*, Sample: *Most Recent*, Date: *Today* -> gives you
   today's step total. Name the output `Steps`.
2. **Get Health Sample** -> Type: *Sleep Analysis*, Sample: *Most Recent* -> gives you last
   night's sleep. You'll need a **Calculate** or **Get Details of Health Sample** (Duration)
   action to turn it into hours -- Shortcuts returns sleep as a duration in seconds/minutes,
   divide by 3600 for hours. Name the result `SleepHours`.
3. *(Optional)* **Get Health Sample** -> Type: *Weight*, Sample: *Most Recent* -> `WeightKg`
   (if you log weight into Apple Health from a smart scale or manually; skip this if you'd
   rather keep weight typed into Buhat only).
4. **Get Contents of URL** (sign-in request):
   - URL: `https://dmyelqbeifdirjpqvhsl.supabase.co/auth/v1/token?grant_type=password`
   - Method: POST
   - Headers: `apikey` = `sb_publishable_oaRcQ24PWSG56ntbdGBDWg_mIeCcul8`, `Content-Type` = `application/json`
   - Request Body (JSON): `{"email": "fortsaulog@gmail.com", "password": "<your Supabase Auth password>"}`
   - The password goes directly into this Shortcut action, stored only on your device in the
     Shortcuts app -- same trust level as it being saved in Safari's password autofill. Not
     handled by Claude, not in this repo.
5. **Get Dictionary from Input** on the previous result -> **Get Value for** `access_token`.
   Name it `Token`.
6. **Get Contents of URL** (write health_logs):
   - URL: `https://dmyelqbeifdirjpqvhsl.supabase.co/rest/v1/health_logs?on_conflict=user_id,date`
   - Method: POST
   - Headers: `apikey` = the same publishable key, `Authorization` = `Bearer` + `Token`,
     `Content-Type` = `application/json`, `Prefer` = `resolution=merge-duplicates`
   - Request Body (JSON):
     ```json
     {"date": "<today's date, YYYY-MM-DD>", "steps": <Steps>, "sleep_hours": <SleepHours>}
     ```
   - Use Shortcuts' **Format Date** action to get today as `YYYY-MM-DD` for the `date` field.
7. *(Optional, only if you added the Weight step)* Repeat action 6 against
   `https://dmyelqbeifdirjpqvhsl.supabase.co/rest/v1/weight_logs?on_conflict=user_id,date`
   with body `{"date": "<today>", "kg": <WeightKg>}`. This writes the same table the Buhat
   weight field uses -- whichever was entered last (Shortcut or manual) wins, they don't
   conflict.

## Step 2: test it once manually

Run the Shortcut by tapping it. If step 6 fails with a permission error, double check the
password in step 4 and that Row Level Security in `supabase/schema.sql` has actually been
applied (the `health_logs`/`weight_logs` tables and their policies) -- run that file in the
Supabase SQL editor first if you haven't.

## Step 3: automate it (optional)

Shortcuts app -> **Automation** tab -> **+** -> **Time of Day**, e.g. 23:00 daily -> pick
this Shortcut -> turn off "Ask Before Running" once you trust it. Sleep data for "last
night" is generally complete by then; steps will keep accumulating after a 23:00 run if
you're still up, so a run at 23:00 slightly undercounts a late night -- that's a real
limitation, not a bug, and matches how any snapshot-based tracker behaves.

## Where this shows up

As of 2026-09-09, Buhat has a "Health & Strava" card that reads today's `health_logs` row
back (steps/sleep) once you're signed into Sync -- this doc only covers getting the data
*into* Supabase in the first place. `scripts/query-logs.py --table health_logs --today` also
reads it back for a Nippard/Sevro session.
