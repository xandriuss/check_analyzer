import React, { useMemo } from "react";

import { clerkTokenCache } from "@/lib/clerkTokenCache";
import { CLERK_ENABLED, CLERK_PUBLISHABLE_KEY, CONVEX_ENABLED, CONVEX_URL } from "@/lib/serviceConfig";

declare const require: any;

export function AppServiceProviders({ children }: { children: React.ReactNode }) {
  if (!CLERK_ENABLED) {
    return <>{children}</>;
  }

  const { ClerkProvider } = require("@clerk/clerk-expo");

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={clerkTokenCache}>
      {CONVEX_ENABLED ? <ConvexClerkProvider>{children}</ConvexClerkProvider> : children}
    </ClerkProvider>
  );
}

function ConvexClerkProvider({ children }: { children: React.ReactNode }) {
  const { useAuth: useClerkAuth } = require("@clerk/clerk-expo");
  const { ConvexProviderWithClerk } = require("convex/react-clerk");
  const { ConvexReactClient } = require("convex/react");
  const convex = useMemo(() => new ConvexReactClient(CONVEX_URL), []);

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useClerkAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
