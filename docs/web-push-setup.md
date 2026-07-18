# Background Web Push setup

Things To Do 757 uses standards-based Web Push. There is no Firebase or OneSignal account to manage.

## What is already automated

- VAPID credentials are stored in Vercel. Only the public key is sent to browsers.
- Signed-in members can subscribe a browser from **Saved-place alerts**.
- The service worker displays notifications while the site is closed.
- GitHub Actions calls the secured alert scan every 15 minutes.
- Expired browser subscriptions are removed automatically.
- Each event/heat alert is recorded so members are not sent duplicates.

## One-time Supabase database step

The push tables must exist before the first member subscribes. Apply
`supabase/migrations/20260718210000_add_web_push.sql` in either of these ways:

### Supabase Dashboard

1. Open the project's **SQL Editor**.
2. Create a new query.
3. Paste the migration file and run it once.

### Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The tables have Row Level Security enabled and no browser-facing policies. Only server routes using the service role can read subscriptions.

## GitHub scheduler

The public repository can run scheduled Actions without using Vercel Pro. The workflow is
`.github/workflows/push-alerts.yml`, and the repository secret is named `CRON_SECRET`.

If the project moves to Vercel Pro, this workflow can be replaced by a Vercel cron entry for
`/api/push/send` every 15 minutes.

## iPhone behavior

On iPhone and iPad, a person must add the app to their Home Screen, open that installed app, sign in, and tap the alert toggle. Permission must be requested from that direct tap. No Apple Developer Program membership is required for standards-based Web Push.

## Smoke test

1. Deploy the migration and application.
2. Sign in on a supported browser and save a venue.
3. Enable **Saved-place alerts**.
4. Run the **Saved-place alert scan** workflow manually from GitHub Actions.
5. The route will send only if the saved venue has a qualifying event in the next three hours or at least two distinct location-verified nearby members.
