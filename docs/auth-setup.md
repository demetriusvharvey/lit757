# Sign-in setup

The app supports four professional sign-in paths through Supabase Auth:

- Google OAuth
- Facebook OAuth
- Email magic links
- Mobile phone codes by SMS

`/api/auth/providers` reads the live Supabase Auth settings. The account screen only shows methods that are genuinely enabled, so users never land on a button that cannot complete sign-in.

## URLs to allow

In Supabase **Authentication → URL Configuration**, set the production site URL and allow both production and local development redirects:

```text
Site URL: https://lit757.vercel.app

Redirect URLs:
https://lit757.vercel.app/**
http://localhost:3000/**
```

The OAuth callback used when configuring Google and Facebook is:

```text
https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
```

Use the exact callback shown in Supabase **Authentication → Providers** for the project.

## Google

1. Create or select a Google Cloud project.
2. Configure the OAuth consent screen and the public app name.
3. Create a **Web application** OAuth client.
4. Add `https://lit757.vercel.app` and `http://localhost:3000` as authorized JavaScript origins.
5. Add the Supabase callback URL as an authorized redirect URI.
6. In Supabase **Authentication → Providers → Google**, enter the client ID and client secret, then enable Google.

Guide: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google)

## Facebook

1. Create a consumer app in the Meta developer dashboard and add Facebook Login.
2. Add the Supabase callback URL to the valid OAuth redirect URIs.
3. Use the app ID and app secret in Supabase **Authentication → Providers → Facebook**.
4. Request the standard `email` and `public_profile` permissions and complete Meta's production requirements before making the app public.
5. Enable Facebook in Supabase.

Guide: [Supabase Facebook sign-in](https://supabase.com/docs/guides/auth/social-login/auth-facebook)

## Phone

Phone sign-in sends a six-digit one-time code and verifies it in the app. It requires an SMS provider because every code is a real text message.

1. Choose an SMS provider supported by Supabase, such as Twilio, MessageBird, or Vonage.
2. Create the provider account and sender/phone-number configuration.
3. In Supabase **Authentication → Providers → Phone**, enter the provider credentials and enable phone sign-in.
4. Set sensible rate limits and test with a real `+1` number before production.
5. Monitor delivery failures and SMS spend in the provider dashboard.

Guide: [Supabase phone login](https://supabase.com/docs/guides/auth/phone-login)

## Email

Email magic links already work in the code. For reliable branded production delivery, configure custom SMTP in Supabase instead of relying on the default trial sender. Test that the link returns to both the production domain and localhost.

## Verification checklist

- Sign in and sign out with each enabled method.
- Confirm Google and Facebook return to the production domain.
- Confirm a new phone user receives a code and an existing phone user can return.
- Confirm one person does not accidentally create separate accounts by using different methods. Add identity linking before encouraging members to switch methods.
- Confirm saved places and alert preferences load after every sign-in method.
- Confirm disabled providers disappear from the account screen.

