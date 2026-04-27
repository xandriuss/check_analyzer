import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "@/context/auth";
import { AppServiceProviders } from "@/lib/AppServiceProviders";

export default function RootLayout() {
  return (
    <AppServiceProviders>
      <AuthProvider>
        <Slot />
        <StatusBar style="dark" />
      </AuthProvider>
    </AppServiceProviders>
  );
}
