import { Capacitor } from "@capacitor/core";

// Packaged apps read their cache; optional PC sync uses a separate pinned-TLS plugin.
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
