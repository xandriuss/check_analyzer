export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL ?? "https://your-clerk-frontend-api-url.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
};
