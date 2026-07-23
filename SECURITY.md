# Buzz Security Policy

## Reporting a vulnerability

Please do not open a public issue for suspected security vulnerabilities. Use the support contact published in the Buzz application and include a clear description, reproduction steps, affected URLs, and impact.

Do not include secrets, personal data, or active exploit payloads in public reports.

## Supported version

Only the current production release and the default branch receive security fixes.

## Security expectations

- Secrets must remain server-side and must never use a `NEXT_PUBLIC_` prefix.
- Privileged Supabase service-role clients may only be used in server-only modules and protected routes.
- State-changing API routes require authentication or a dedicated server-to-server secret, strict input validation, and rate limiting.
- Personal data collection must be minimized and documented.
- Security findings affecting authentication, authorization, secrets, personal data, or scoring integrity must be fixed before release.
