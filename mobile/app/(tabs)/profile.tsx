import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/context/auth";

type MenuItem = {
  title: string;
  description: string;
  icon: "exclamationmark.bubble.fill" | "gearshape.fill" | "wrench.and.screwdriver.fill";
  path: "/(tabs)/bugs" | "/(tabs)/settings" | "/(tabs)/debug";
  adminOnly?: boolean;
};

const MENU_ITEMS: MenuItem[] = [
  {
    title: "Bug reports",
    description: "Send feedback and view admin reports.",
    icon: "exclamationmark.bubble.fill",
    path: "/(tabs)/bugs",
  },
  {
    title: "Settings",
    description: "Dark mode, app updates, and junk exclusions.",
    icon: "gearshape.fill",
    path: "/(tabs)/settings",
  },
  {
    title: "Debug",
    description: "Developer scan details and parsed receipt data.",
    icon: "wrench.and.screwdriver.fill",
    path: "/(tabs)/debug",
    adminOnly: true,
  },
];

export default function ProfileScreen() {
  const { user } = useAuth();
  const dark = Boolean(user?.dark_mode);
  const visibleItems = MENU_ITEMS.filter((item) => !item.adminOnly || user?.role === "admin");

  return (
    <ScrollView style={[styles.container, dark && styles.darkContainer]} contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>{user?.mode === "family" ? "Family mode" : "Personal mode"}</Text>
      <Text style={[styles.title, dark && styles.darkText]}>Profile</Text>

      <View style={[styles.profilePanel, dark && styles.darkPanel]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.display_name || user?.email || "U").slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.profileText}>
          <Text style={[styles.profileName, dark && styles.darkText]}>{user?.display_name || "Receipt Lens"}</Text>
          <Text style={[styles.profileEmail, dark && styles.darkMuted]}>{user?.email}</Text>
        </View>
      </View>

      <View style={styles.menuList}>
        {visibleItems.map((item) => (
          <Pressable
            key={item.title}
            onPress={() => router.push(item.path)}
            style={({ pressed }) => [styles.menuRow, dark && styles.darkPanel, pressed && styles.pressed]}
          >
            <View style={styles.iconWrap}>
              <IconSymbol color="#e45b2c" name={item.icon} size={24} />
            </View>
            <View style={styles.menuText}>
              <Text style={[styles.menuTitle, dark && styles.darkText]}>{item.title}</Text>
              <Text style={[styles.menuDescription, dark && styles.darkMuted]}>{item.description}</Text>
            </View>
            <IconSymbol color={dark ? "#b8c4c2" : "#6d7475"} name="chevron.right" size={22} />
          </Pressable>
        ))}
      </View>

      {!user?.is_subscriber && (
        <Pressable onPress={() => router.push("/subscription")} style={styles.proButton}>
          <Text style={styles.proButtonText}>View Pro</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f4ef",
  },
  darkContainer: {
    backgroundColor: "#101718",
  },
  screen: {
    flexGrow: 1,
    gap: 16,
    padding: 20,
    paddingTop: 56,
    paddingBottom: 96,
  },
  eyebrow: {
    color: "#e45b2c",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: "#1b2a2f",
    fontSize: 34,
    fontWeight: "900",
  },
  profilePanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  darkPanel: {
    backgroundColor: "#182326",
    borderColor: "#2f3d40",
  },
  avatar: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 23,
    backgroundColor: "#183f45",
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    color: "#1b2a2f",
    fontSize: 17,
    fontWeight: "900",
  },
  profileEmail: {
    color: "#657174",
    fontSize: 13,
  },
  menuList: {
    gap: 10,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 78,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  pressed: {
    opacity: 0.8,
  },
  iconWrap: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#fff1eb",
  },
  menuText: {
    flex: 1,
    gap: 3,
  },
  menuTitle: {
    color: "#1b2a2f",
    fontSize: 17,
    fontWeight: "900",
  },
  menuDescription: {
    color: "#657174",
    lineHeight: 19,
  },
  proButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#e45b2c",
  },
  proButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  darkText: {
    color: "#f3f7f5",
  },
  darkMuted: {
    color: "#b8c4c2",
  },
});
