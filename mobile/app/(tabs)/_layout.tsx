import { Tabs, router } from "expo-router";
import React, { useEffect } from "react";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/context/auth";
import { useI18n } from "@/lib/i18n";

export default function TabLayout() {
  const { token } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    if (!token) {
      router.replace("/" as never);
    }
  }, [token]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#e45b2c",
        tabBarInactiveTintColor: "#6d7475",
        tabBarButton: HapticTab,
        tabBarStyle: {
          minHeight: 64,
          paddingTop: 8,
          backgroundColor: "#ffffff",
          borderTopColor: "#e6e1d7",
        },
      }}
    >
      <Tabs.Screen
        name="history"
        options={{
          title: t("data"),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="chart.bar.doc.horizontal.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: t("camera"),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="camera.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("profile"),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="person.crop.circle.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="debug"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="bugs"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
