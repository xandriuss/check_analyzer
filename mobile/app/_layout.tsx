import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "@/context/auth";
import { AppServiceProviders } from "@/lib/AppServiceProviders";
import { AutoUpdate } from "@/lib/AutoUpdate";
import { I18nProvider } from "@/lib/i18n";

export default function RootLayout() {
  return (
    <I18nProvider>
      <AppServiceProviders>
        <AuthProvider>
          <AutoUpdate />
          <Slot />
          <StatusBar style="dark" />
        </AuthProvider>
      </AppServiceProviders>
    </I18nProvider>
  );
}
