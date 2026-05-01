# Release notes

## Do not commit secrets

Never upload these files to GitHub:

- `App/.env`
- `App/app.db`
- `App/uploads/`
- any file containing `OPENAI_API_KEY`, `SECRET_KEY`, `ADMIN_PASSWORD`, or real user data

Use `App/.env.example` as the public template.

## Admin account

Set these values in `App/.env` before starting the backend:

```env
ADMIN_EMAIL=your_admin_email@example.com
ADMIN_PASSWORD=your_strong_admin_password
```

When the backend starts, it creates or upgrades that account to `admin`.
Only admin users can see the Debug tab and all bug reports.

## Android without a publisher account

You can build an Android APK and upload it to GitHub Releases.
Users can download and sideload it, but Android will warn them because it is not from Google Play.

## iPhone / iOS

iOS does not have a normal APK-style install flow.
For broad public installation you normally need Apple Developer publishing, TestFlight, or another Apple-approved distribution path.
The app should still be kept iOS-compatible in code, but public iPhone distribution is restricted by Apple.

## Backend

This app needs a backend because the OpenAI API key must stay secret.
Do not put the OpenAI key inside the mobile app.

Real subscription payments also need backend verification. For production billing, set
`SUBSCRIPTION_PROVIDER=revenuecat` on the backend and keep `REVENUECAT_SECRET_KEY`
only on Railway. The mobile app should only receive the public RevenueCat keys:

```powershell
$env:EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY="goog_your_public_key"
$env:EXPO_PUBLIC_REVENUECAT_IOS_API_KEY="appl_your_public_key"
```

For real users, host the FastAPI backend on a server and set:

```powershell
$env:EXPO_PUBLIC_API_URL="https://your-backend-domain"
```

For local testing:

```powershell
$env:EXPO_PUBLIC_API_URL="http://YOUR_COMPUTER_IP:8000"
```
