import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "@/context/auth";
import { AppServiceProviders } from "@/lib/AppServiceProviders";
import { AutoUpdate } from "@/lib/AutoUpdate";

export default function RootLayout() {
  return (
    <AppServiceProviders>
      <AuthProvider>
        <AutoUpdate />
        <Slot />
        <StatusBar style="dark" />
      </AuthProvider>
    </AppServiceProviders>
  );
}
