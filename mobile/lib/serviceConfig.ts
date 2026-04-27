export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";

export const CLERK_ENABLED = CLERK_PUBLISHABLE_KEY.length > 0;
export const CONVEX_ENABLED = CLERK_ENABLED && CONVEX_URL.length > 0;
