import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.jiezheshuizz.niohcompanion",
  appName: "Nioh 存档伴侣",
  loggingBehavior: "none",
  webDir: "dist-android",
  server: { androidScheme: "https", cleartext: false },
  android: { allowMixedContent: false, backgroundColor: "#090a0a" },
};

export default config;
