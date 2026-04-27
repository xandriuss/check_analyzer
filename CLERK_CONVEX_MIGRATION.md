# Clerk + Convex migration

The app is now prepared for Clerk and Convex, but the current FastAPI backend still handles scanning and the legacy data endpoints until we fully switch over.

## Current migration state

- Clerk and Convex packages are installed in `mobile/`.
- `mobile/app/_layout.tsx` wraps the app with Clerk and Convex providers only when env keys are present.
- `mobile/convex/schema.ts` defines the future app database shape.
- `mobile/convex/auth.config.ts` is ready for Clerk-backed Convex auth.
- Existing FastAPI login/database still works as fallback.

## Values to create/copy

Create a Clerk app, then copy:

```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_or_pk_live_from_clerk
```

Create a Convex project, then copy:

```env
EXPO_PUBLIC_CONVEX_URL=https://your-convex-deployment.convex.cloud
```

In Clerk, activate the Convex integration and copy the Frontend API URL:

```env
CLERK_FRONTEND_API_URL=https://your-clerk-frontend-api-url.clerk.accounts.dev
```

Put these in `mobile/.env.local` for local work and in EAS environment variables for builds.

## Deploy Convex schema/auth

From `mobile/`:

```powershell
npx convex dev
```

For production:

```powershell
npx convex deploy
```

## Migration order

1. Switch mobile login/register UI to Clerk.
2. Add a FastAPI endpoint that accepts Clerk tokens for scanner uploads.
3. Move receipts, receipt items, settings, and bug reports to Convex.
4. Keep FastAPI as the image/OCR/AI scanner microservice.
5. Replace demo subscription with Clerk Billing or store billing after auth/data are stable.

## Important billing note

Clerk Billing is useful for web/SaaS subscriptions. For native Android/iOS in-app purchases, check Google Play and Apple rules before charging inside the app with an external checkout.
