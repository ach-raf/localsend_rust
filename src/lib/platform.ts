import { isAndroid } from "tauri-plugin-android-fs-api";

export function detectAndroid(check: () => boolean = isAndroid): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}
