# Real Buzz Notifications — Production Setup

The notification code is deployed. Complete these one-time infrastructure steps to activate real background delivery.

## 1. Run the Supabase migration

In Supabase Dashboard → SQL Editor, paste and run:

`supabase/migrations/20260720_notifications_mvp.sql`

This prepares:

- authenticated saved venues
- per-venue Buzz thresholds
- push subscriptions
- cooldowns
- quiet hours
- row-level security

## 2. Generate VAPID keys

From the project directory:

```bash
npm install
npm run push:keys
```

The command returns a public key and private key. Keep the private key secret.

## 3. Add Vercel environment variables

Vercel → Project → Settings → Environment Variables:

```text
VAPID_PUBLIC_KEY=<generated public key>
VAPID_PRIVATE_KEY=<generated private key>
VAPID_SUBJECT=mailto:hello@lit757.app
CRON_SECRET=<a long random secret>
```

Add each variable to Production and Preview, then redeploy.

The existing variables must remain configured:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## 4. Schedule Buzz checks in Supabase

Open `supabase/notifications_scheduler.sql`.

Replace:

```text
REPLACE_WITH_THE_SAME_CRON_SECRET
```

with the exact `CRON_SECRET` added to Vercel. Run the SQL in Supabase SQL Editor.

This calls `/api/notifications/check` every 10 minutes. Supabase scheduling is used because frequent Vercel cron schedules may not be available on the current Vercel plan.

## 5. Test on iPhone

Web Push on iPhone requires the installed web app experience:

1. Open `https://lit757.vercel.app` in Safari.
2. Tap Share.
3. Tap **Add to Home Screen**.
4. Open LIT757 from the new Home Screen icon.
5. Sign in.
6. Save a venue.
7. Open Alerts and enable notifications.
8. Tap **Send me a test alert**.

The Alerts screen will show one of these states:

- Push delivery connected
- Sign-in required
- Permission required
- Add to Home Screen required
- VAPID setup required

## Delivery behavior

A notification is sent only when:

- the user is signed in
- the venue is watched
- the venue crosses the selected threshold from below
- the venue is outside its cooldown window
- the current time is outside quiet hours

Defaults:

- threshold: Buzz 80
- cooldown: 180 minutes per venue
- quiet hours: 10:00 PM–8:00 AM
- timezone: America/New_York

## Important API routes

```text
GET/POST /api/preferences
GET      /api/push/public-key
POST     /api/push/subscribe
POST     /api/notifications/test
GET      /api/notifications/check
```
