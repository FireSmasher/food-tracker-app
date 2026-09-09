# Apple Health -> Saulog OS, via iOS Shortcuts

Safari (and any PWA installed from it) can never read HealthKit directly -- that's an iOS
platform restriction, not something fixable in this app's code. The Shortcuts app is the
only thing on the phone that can read Health data *and* make HTTP requests, so it's the
bridge. Build it once, then it runs on a schedule.

Updated 2026-09-09: now covers six fields, not two. Edwin picked these when Strava turned
out to be subscriber-only, making Apple Health/Fitness the only body-data source.

## What it sends

One row per day into `health_logs`, upserted on `(user_id, date)` so re-running it the same
day overwrites rather than duplicating:

| Field | Health sample | Notes |
|---|---|---|
| `steps` | Steps | Today's total |
| `active_energy_kcal` | Active Energy | What the watch says you burned |
| `exercise_minutes` | Apple Exercise Time | The Fitness "Exercise" ring |
| `workout_type` | Workouts (most recent) | e.g. "Traditional Strength Training" |
| `sleep_hours` | Sleep Analysis | Last night, converted to hours |
| `resting_hr` | Resting Heart Rate | Most recent reading |

**Nothing in the app subtracts `active_energy_kcal` from your food targets.** Your kcal
target is a fixed Nippard number (2300), not a moving TDEE. This data is there to look at
and for Nippard sessions to read, so logging a lifting session in Buhat *and* having the
watch report calories cannot double-count against anything.

## Step 1: build the Shortcut

Shortcuts app -> **+** (new shortcut). Add these in order.

**The six Health reads.** Each one is a **Get Health Sample** action. After adding it, tap
the blue variable it produces and rename it so later steps can reference it:

1. Type: *Steps*, Sample: *Most Recent*, Date: *Today* -> rename to `Steps`
2. Type: *Active Energy*, Sample: *Most Recent*, Date: *Today* -> rename to `ActiveEnergy`
3. Type: *Apple Exercise Time*, Sample: *Most Recent*, Date: *Today* -> rename to `ExerciseMin`
4. Type: *Workouts*, Sample: *Most Recent*, Date: *Today* -> then add **Get Details of
   Health Sample** -> Detail: *Workout Activity Type* -> rename to `WorkoutType`
5. Type: *Sleep Analysis*, Sample: *Most Recent* -> then add **Get Details of Health
   Sample** -> Detail: *Duration*. Sleep comes back in seconds, so add a **Calculate**
   action: `Duration ÷ 3600` -> rename to `SleepHours`
6. Type: *Resting Heart Rate*, Sample: *Most Recent* -> rename to `RestingHR`

**Today's date in the right format.** Add a **Format Date** action:
- Date: *Current Date*
- Format: *Custom* -> `yyyy-MM-dd`
- Rename to `Today`

**Sign in.** Add **Get Contents of URL**:
- URL: `https://dmyelqbeifdirjpqvhsl.supabase.co/auth/v1/token?grant_type=password`
- Method: **POST**
- Headers:
  - `apikey` = `sb_publishable_oaRcQ24PWSG56ntbdGBDWg_mIeCcul8`
  - `Content-Type` = `application/json`
- Request Body: **JSON**
  - `email` (Text) = `fortsaulog@gmail.com`
  - `password` (Text) = your Supabase Auth password

The password lives only inside this Shortcut on your device, same trust level as Safari's
password autofill. Not handled by Claude, not in this repo.

**Pull the token out.** Add **Get Dictionary from Input**, then **Get Dictionary Value** ->
Key: `access_token` -> rename to `Token`.

**Write the row.** Add **Get Contents of URL**:
- URL: `https://dmyelqbeifdirjpqvhsl.supabase.co/rest/v1/health_logs?on_conflict=user_id,date`
- Method: **POST**
- Headers:
  - `apikey` = `sb_publishable_oaRcQ24PWSG56ntbdGBDWg_mIeCcul8`
  - `Authorization` = `Bearer ` followed by the `Token` variable
  - `Content-Type` = `application/json`
  - `Prefer` = `resolution=merge-duplicates`
- Request Body: **JSON**, with these keys (insert the matching variable as each value):
  - `date` = `Today`
  - `steps` = `Steps`
  - `active_energy_kcal` = `ActiveEnergy`
  - `exercise_minutes` = `ExerciseMin`
  - `workout_type` = `WorkoutType`
  - `sleep_hours` = `SleepHours`
  - `resting_hr` = `RestingHR`

Name the Shortcut something like "Health to Saulog" and save.

## Step 2: test it once

Tap the Shortcut to run it. Then, on a Mac with the service config set up:

```
cd ~/food-tracker-app && python3 scripts/query-logs.py --table health_logs --today
```

A row should come back with your numbers in it. Open Buhat in the app (signed into Sync)
and the Apple Health card shows the same values.

**If it fails**, the usual causes in order:
- Wrong Supabase password in the sign-in action
- A field left empty because that Health type has no data today (fine, send it anyway,
  the column is nullable)
- `supabase/schema.sql` not re-run since 2026-09-09, so the four newer columns
  (`active_energy_kcal`, `exercise_minutes`, `workout_type`, `resting_hr`) don't exist yet.
  That shows up as a `42703 column does not exist` error.

## Step 3: automate it

Shortcuts app -> **Automation** tab -> **+** -> **Time of Day** -> 23:00, Daily -> pick this
Shortcut -> turn off "Ask Before Running."

Sleep for "last night" is complete by then. Steps and active energy keep accumulating after
a 23:00 run, so a late night is slightly undercounted. That's how any snapshot tracker
behaves, not a bug. Re-running the Shortcut manually later the same day overwrites the row
with fresher numbers.

## Where this shows up

- **In the app:** Buhat -> "Apple Health" card, when signed into Sync.
- **For Nippard/Sevro sessions:** `scripts/query-logs.py --table health_logs --today`.
