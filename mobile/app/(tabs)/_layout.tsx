import { Tabs, router } from "expo-router";
import React, { useEffect } from "react";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/context/auth";

export default function TabLayout() {
  const { token, user } = useAuth();

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
        name="camera"
        options={{
          title: "Camera",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="camera.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Data",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="chart.bar.doc.horizontal.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="debug"
        options={{
          title: "Debug",
          href: user?.role === "admin" ? undefined : null,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="wrench.and.screwdriver.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="bugs"
        options={{
          title: "Bugs",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="exclamationmark.bubble.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="gearshape.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
