import { useEffect } from "react";
import {
  isPermissionGranted,
  onAction,
  requestPermission,
  type Options,
} from "@tauri-apps/plugin-notification";
import { isAndroid } from "tauri-plugin-android-fs-api";
import { notifications } from "../lib/notifications";
import { openReceivedFile } from "../lib/receivedFiles";

const PERMISSION_PROMPTED_KEY = "local-share.notification-permission-prompted";

type NotificationAction = {
  actionId?: string;
  notification?: Options;
};

export default function AndroidNotificationBridge() {
  useEffect(() => {
    let disposed = false;
    let removeActionListener: (() => void) | undefined;

    try {
      if (!isAndroid()) return;
    } catch {
      return;
    }

    void onAction((rawAction) => {
      const action = rawAction as unknown as NotificationAction;
      const extra = action.notification?.extra;
      if (
        action.actionId !== "tap" ||
        extra?.kind !== "received-file" ||
        typeof extra.fileUri !== "string"
      ) {
        return;
      }

      void openReceivedFile({ file_uri: extra.fileUri }).catch((error) => {
        console.error("Failed to open received file:", error);
        notifications.show({
          title: "Unable to open file",
          message: String(error),
          color: "red",
        });
      });
    }).then((listener) => {
      if (disposed) listener.unregister();
      else removeActionListener = () => listener.unregister();
    }).catch((error) => {
      console.error("Failed to listen for notification actions:", error);
    });

    void (async () => {
      if (
        !(await isPermissionGranted()) &&
        !localStorage.getItem(PERMISSION_PROMPTED_KEY)
      ) {
        localStorage.setItem(PERMISSION_PROMPTED_KEY, "true");
        await requestPermission();
      }
    })().catch((error) => {
      localStorage.removeItem(PERMISSION_PROMPTED_KEY);
      console.error("Failed to initialize Android notifications:", error);
    });

    return () => {
      disposed = true;
      removeActionListener?.();
    };
  }, []);

  return null;
}
