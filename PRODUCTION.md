# Production setup

This app has two parts:

- `App/` - FastAPI backend. This must run on a server 24/7.
- `mobile/` - Expo Android/iOS app. This connects to the backend URL.

## 1. Backend hosting

Use a hosting provider that can run a Docker web service.

Set these environment variables on the server:

```env
OPENAI_API_KEY=your-real-openai-key
SECRET_KEY=a-long-random-secret
ADMIN_EMAIL=your-admin-email
ADMIN_PASSWORD=your-admin-password
DATABASE_URL=postgresql+psycopg://user:password@host:5432/database
ALLOWED_ORIGINS=*
```

Never put `OPENAI_API_KEY` or `SECRET_KEY` inside the mobile app.

The backend exposes:

```text
GET /health
GET /docs
```

Use `/health` to check that the server is alive.

## 2. Database

For local testing, the backend uses SQLite automatically.

For real users, use Postgres through `DATABASE_URL`. SQLite is not a good long-term database for many users on a hosted server.

## 3. Uploaded receipt photos

The current backend stores uploads in `App/uploads`.

That is OK for a demo server, but many hosting providers delete local files when the service restarts or redeploys. For a real app, move uploads to object storage later, for example S3-compatible storage.

## 4. Mobile app API URL

Before building the mobile app, point it to your hosted backend:

```powershell
$env:EXPO_PUBLIC_API_URL="https://your-backend-domain.com"
```

Then build or run the app.

## 5. Android without Play Store

You can share an Android APK file through GitHub Releases. Users can download and install it manually.

This does not require paying for a Google Play publisher account, but users must allow installing apps from outside the Play Store.

## 6. iPhone limitation

iPhones are different. Normal users cannot install an app from GitHub like Android APK.

For iPhone you usually need one of these:

- Apple Developer Program and App Store/TestFlight.
- A web/PWA version hosted online.

## 7. Local production-style backend test

From `App/`:

```powershell
docker build -t receipt-lens-backend .
docker run --env-file .env -p 8000:8000 receipt-lens-backend
```

Then open:

```text
http://localhost:8000/health
```
