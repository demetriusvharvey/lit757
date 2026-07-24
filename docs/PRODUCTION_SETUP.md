# Buzz production setup

Verified against the repository and the GitHub API on **2026-07-24**. Every
claim below was checked rather than assumed. Where something could not be
checked from the repo (Vercel and Supabase dashboards), it is marked
**unverified**.

This supersedes the earlier hand-written 101-step checklist, which had drifted:
three phases were already complete, one phase asked for API keys no code reads,
and the environment list was missing several variables the app requires.

---

## Do this first: what is actually broken

**The production build is not broken.** `Build Check` passes on `main`, and
`npm run validate` (test + lint + typecheck + build) exits 0 locally. There is
no build error to find.

The recurring red X is the scheduled **`Buzz signal refresh`** workflow, and it
is not a code fault:

```
Your free forecast credits are used up. Choose a plan to continue using Radar.
```

All 11 mapped BestTime venues fail with this. The key is valid; the free tier is
exhausted. This is a product decision, not a bug:

- Pay for BestTime, or
- Drop BestTime and lean on the first-party evidence path (partner pulse,
  ground truth, passive presence), which is the stated direction anyway.

Until it is resolved the foot-traffic provider contributes nothing, and the
workflow will keep failing.

---

## Environment variables

Generated from every `process.env.*` read in `app/`, `src/`, `lib/` and
`scripts/`. `.env.example` is accurate and is the canonical template.

### Required for core function

| Variable | Powers |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | database |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser database access |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only database access |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | map rendering |
| `NEXT_PUBLIC_SITE_URL` | canonical URLs and metadata |
| `CRON_SECRET` | scheduled refresh jobs |
| `OPENAI_API_KEY` | `/api/recommendation` and `/api/summary` |

### Required for features that are already built

| Variable | Powers |
| --- | --- |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | web push notifications |
| `RESEND_API_KEY`, `SIGNUP_EMAIL_FROM` | transactional email |
| `OWNER_SIGNUP_WEBHOOK_URL` | venue-owner signup routing |
| `GOOGLE_PLACES_API_KEY`, `GOOGLE_STREET_VIEW_API_KEY` | venue enrichment and photos |
| `BRANDFETCH_CLIENT_ID` | venue logos (falls back to site icon) |

Generate the VAPID pair with the script that already exists:

```bash
npm run push:keys
```

### Buzz evidence and calibration secrets

Generate these yourself; both must be at least 32 characters or the guards
reject them by design.

| Variable | Powers |
| --- | --- |
| `BUZZ_PARTNER_INGEST_SECRET` | venue partner pulse ingestion |
| `BUZZ_GROUND_TRUTH_SECRET` | ground-truth ingestion **and** calibration training |

`BUZZ_GROUND_TRUTH_SECRET` is deliberately a separate trust boundary from
`CRON_SECRET`. Do not reuse one for the other: `CRON_SECRET` is distributed to
schedulers for read-only refresh work, while the ground-truth boundary can read
raw observations and write the artifact that moves public scores.

### Event and signal providers

`TICKETMASTER_API_KEY`, `TICKETMASTER_INVENTORY_API_KEY`,
`EVENTBRITE_PRIVATE_TOKEN`, `SEATGEEK_CLIENT_ID`, `SEATGEEK_CLIENT_SECRET`,
`LOCAL_EVENT_FEEDS_JSON`, `PREDICTHQ_ACCESS_TOKEN`, `TOMTOM_API_KEY`,
`BESTTIME_API_KEY_PRIVATE`, `BESTTIME_API_KEY_PUBLIC`.

### Optional overrides

`OVERPASS_API_URL` (defaults to the public FOSSGIS endpoint) and
`HRT_GTFS_RT_VEHICLE_POSITIONS_JSON_URL`. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and
`NEXT_PUBLIC_BRANDFETCH_CLIENT_ID` exist only as fallbacks for their non-public
counterparts. `VERCEL_PROJECT_PRODUCTION_URL` is supplied by Vercel.

### Do not bother with these yet

No code reads them. They appear only in `src/lib/integration-catalog.ts` as
catalog entries marked `needs-key` or `planned`:

- `AIRNOW_API_KEY`
- `NPS_API_KEY`
- `AI_GATEWAY_API_KEY` — reserved for a future Vercel AI Gateway migration;
  `OPENAI_API_KEY` is what actually runs today

Creating AirNow and NPS developer accounts produces no functional change until
those integrations are built.

### Before saving

Confirm no private secret is prefixed `NEXT_PUBLIC_`. Anything so prefixed is
compiled into the browser bundle. The two `NEXT_PUBLIC_` entries above are a
push *public* key and a publishable Brandfetch client ID, both safe to expose.

---

## Supabase

**Unverified** — requires dashboard access.

1. Back up the production database before applying anything.
2. Apply every migration in `supabase/migrations/` in timestamp order. There are
   11 after PR #98 merges, most recently:
   - `20260723170000_buzz_realtime_platform.sql`
   - `20260724150000_security_reconciliation.sql`
   - `20260724160000_buzz_ml_calibration.sql` *(added by PR #98)*
3. Verify storage buckets are not publicly writable, with size and MIME
   restrictions on uploads.

Row-level security is enforced **in the migration SQL itself**, not by hand in
the dashboard. `src/lib/security/migrations.test.ts` asserts that every table
created by a Buzz migration also enables RLS, and that test passes. So applying
the migrations *is* the RLS work — there are no policies left to click through.

---

## GitHub

Verified through the GitHub API on 2026-07-24.

### Already done — no action

- PR #86 closed, #87 merged, #91 merged, plus #94–#97 merged since. The entire
  "GitHub cleanup" phase of the old checklist is complete.
- **CodeQL** is enabled (21 analyses recorded).
- **Secret scanning** is enabled.
- **Push protection** is enabled.

### Still outstanding

- **Branch protection on `main`: not configured.** Enable it only after you know
  the exact check name to require. `Build Check` is the workflow that gates
  compilation. Requiring a check whose name does not match exactly will block
  every merge, including your own.
- **Dependabot security updates: disabled.** `.github/dependabot.yml` exists and
  drives version updates, but security updates are off in repo settings.

### Worth knowing

The repository is **public**. Push protection is what has been standing between
a pasted secret and permanent exposure. If any key was ever committed, rotate
it rather than deleting the commit.

### Cruft

23 workflows exist, of which roughly nine are spent one-shot patch jobs
(`apply-buzz-source-fix`, `one-time-buzz-branch-patch`,
`elite-live-activity-ui-once`, `restore-mobile-map-pins`, three
`fix-mobile-map-*`, and similar). There are 93 remote branches. Neither is
urgent; both make the repository harder to reason about.

---

## Order of operations

1. Resolve the BestTime credit decision — it is the only thing currently red.
2. Set environment variables in Vercel across Production, Preview and
   Development. Redeploy.
3. Apply Supabase migrations, including `20260724160000` once PR #98 lands.
4. Merge PR #98, then PR #88.
5. Enable Dependabot security updates and branch protection.

Steps 1–3 gate everything else. Merging before the environment is configured
means the new calibration trainer will return 401 on every scheduled run — which
is correct fail-closed behavior, not a fault.
