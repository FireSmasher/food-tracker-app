// health-ingest: one POST from the iOS Health Shortcut, one row in health_logs.
//
// WHY THIS EXISTS: without it, the Shortcut has to log in to Supabase itself (POST to
// /auth/v1/token, dig the JWT out of the response, then send it as a Bearer token on a
// second request). That's ~12 actions to build by hand on a phone, and it puts Edwin's
// actual account password inside the Shortcut. This collapses it to a single POST with a
// shared secret, so the Shortcut is ~4 actions and holds no password.
//
// DEPLOY (no CLI needed, the dashboard can do all of it):
//   1. Supabase -> Edge Functions -> Deploy a new function -> Via Editor
//   2. Name it exactly `health-ingest`, paste this file, Deploy
//   3. Function's Details page -> Security -> turn OFF "Enforce JWT Verification"
//      (this function does its own auth via the shared secret below; leaving it on would
//      reject the Shortcut, which has no Supabase session). Known Supabase bug: this
//      toggle has been reported silently resetting to on after a redeploy, so re-check it
//      any time you edit the function.
//   4. Project Settings -> Edge Functions -> Secrets, add:
//        SAULOG_SHARED_SECRET = a long random string you invent
//        SAULOG_USER_ID       = the UID from Authentication -> Users
//      SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically, don't add them.
//
// The dashboard editor has no version history, which is exactly why this file is also kept
// here in the repo. This copy is the source of truth; paste from here.

const SHARED_SECRET = Deno.env.get("SAULOG_SHARED_SECRET");
const USER_ID = Deno.env.get("SAULOG_USER_ID");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Every column the Shortcut is allowed to write. Anything else in the body is ignored
// rather than passed through, so a typo'd key can't create surprise behaviour downstream.
const NUMERIC_FIELDS = [
  "steps",
  "sleep_hours",
  "active_energy_kcal",
  "exercise_minutes",
  "resting_hr",
] as const;

// Compares in constant time so a caller can't discover the secret one character at a time
// by measuring how long the rejection takes.
function secretMatches(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Shortcuts sends everything as a string, and sends an empty string for a Health metric
// that had no samples today. Empty must become null (absent reading), not 0 (a real
// measurement of zero) -- those mean very different things for sleep or resting heart rate.
function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }
  if (!SHARED_SECRET || !USER_ID || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Misconfiguration, not the caller's fault -- but don't leak which piece is missing.
    console.error("missing env", {
      secret: !!SHARED_SECRET,
      user: !!USER_ID,
      url: !!SUPABASE_URL,
      key: !!SERVICE_ROLE_KEY,
    });
    return json({ error: "function not configured" }, 500);
  }

  const provided = req.headers.get("x-shared-secret") ?? "";
  if (!secretMatches(provided, SHARED_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  const row: Record<string, unknown> = { user_id: USER_ID };
  for (const field of NUMERIC_FIELDS) {
    const value = toNumberOrNull(body[field]);
    if (value !== null) row[field] = value;
  }
  const workoutType = typeof body.workout_type === "string" ? body.workout_type.trim() : "";
  if (workoutType) row.workout_type = workoutType;

  // `date` is optional: health_logs defaults it to today in Europe/Berlin. Only honour an
  // explicit one if it's a real YYYY-MM-DD, so a malformed Shortcut value can't silently
  // file today's numbers under a garbage date.
  if (typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date.trim())) {
    row.date = body.date.trim();
  }

  if (Object.keys(row).length === 1) {
    return json({ error: "no recognised fields in body" }, 400);
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/health_logs?on_conflict=user_id,date`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    },
  );

  const text = await res.text();
  if (!res.ok) {
    console.error("upsert failed", res.status, text);
    return json({ error: "write failed", status: res.status, detail: text }, 502);
  }

  return json({ ok: true, written: JSON.parse(text)[0] ?? null }, 200);
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
