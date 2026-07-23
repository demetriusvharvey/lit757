# Buzz App Store Security Baseline

This document is a release gate for any iOS or Android wrapper or native client.

## Secrets and API access

- Never embed Supabase service-role keys, provider client secrets, VAPID private keys, signing keys, or administrative tokens in a mobile bundle.
- Mobile clients use only public client identifiers and short-lived user sessions.
- Sensitive third-party requests are proxied through authenticated Buzz server endpoints.
- Tokens are stored in iOS Keychain or Android Keystore, never localStorage or plaintext preferences.

## Authentication and accounts

- Use standards-based OAuth with PKCE and system browser sessions.
- Validate redirect URIs and state/nonce values.
- Support token revocation, session listing, sign-out from all devices, and verified account deletion.
- Add Sign in with Apple when required by App Review rules.

## Location

- Request the least precise permission needed and prefer foreground-only access.
- Explain the purpose before the operating-system prompt.
- Do not collect background location until a documented feature, retention period, and consent flow exist.
- Do not retain raw location history unless essential.

## Push notifications

- Bind each subscription to the authenticated user and installation.
- Require ownership checks for create, update, and delete operations.
- Expire invalid tokens and support per-venue controls, quiet hours, and global opt-out.
- Rate-limit sends and avoid sensitive content in notification previews.

## Deep links

- Use Apple Universal Links and Android App Links.
- Publish `apple-app-site-association` and `assetlinks.json` only after real application/team/package identifiers and signing fingerprints are known.
- Allowlist routes and parameters; reject external redirect targets.

## WebView restrictions

- Allow HTTPS Buzz origins only.
- Disable mixed content, local file access, arbitrary navigation, and unneeded JavaScript bridges.
- Every native bridge method must have an explicit allowlist and origin validation.
- Open untrusted external links in the system browser.

## Privacy and store declarations

- Keep the public privacy notice, support path, retention policy, and account-deletion path current.
- Inventory every SDK and provider before completing Apple privacy labels and Google Play Data Safety forms.
- Confirm age rating and child-safety posture.
- Run static analysis and dynamic API testing against the release candidate.

## Release gate

A native release cannot ship until authentication, authorization, API rate limiting, deletion, privacy disclosures, push ownership, deep-link association, secure storage, and production monitoring have been tested on both platforms.
