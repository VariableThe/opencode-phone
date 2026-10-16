import { Tabs } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useAppPalette } from "../../src/components/useAppPalette"

export default function TabLayout() {
  // Palette overrides apply only while a server theme is active (`themed`);
  // otherwise every color below is exactly the long-standing dark/light value.
  const { isDark, palette, themed } = useAppPalette()
  const { t } = useTranslation()

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: themed ? palette.primary : isDark ? "#ffffff" : "#0a0a0a",
        tabBarInactiveTintColor: themed ? palette.muted : isDark ? "#666666" : "#999999",
        tabBarStyle: {
          backgroundColor: themed ? palette.background : isDark ? "#0a0a0a" : "#ffffff",
          borderTopColor: themed ? palette.border : isDark ? "#1a1a1a" : "#e5e5e5",
        },
        headerStyle: {
          backgroundColor: themed ? palette.background : isDark ? "#0a0a0a" : "#ffffff",
        },
        headerTintColor: themed ? palette.text : isDark ? "#ffffff" : "#0a0a0a",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("nav.sessionsTab"),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="connections"
        options={{
          title: t("nav.connectionsTab"),
          tabBarIcon: ({ color, size }) => <Ionicons name="server-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("nav.settingsTab"),
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  )
}
