import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/clerk-expo";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";
import React, { useMemo } from "react";

import { clerkTokenCache } from "@/lib/clerkTokenCache";
import { CLERK_ENABLED, CLERK_PUBLISHABLE_KEY, CONVEX_ENABLED, CONVEX_URL } from "@/lib/serviceConfig";

export function AppServiceProviders({ children }: { children: React.ReactNode }) {
  if (!CLERK_ENABLED) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={clerkTokenCache}>
      {CONVEX_ENABLED ? <ConvexClerkProvider>{children}</ConvexClerkProvider> : children}
    </ClerkProvider>
  );
}

function ConvexClerkProvider({ children }: { children: React.ReactNode }) {
  const convex = useMemo(() => new ConvexReactClient(CONVEX_URL), []);

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useClerkAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
