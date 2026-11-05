import { useEffect } from "react";
import {
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
  type Options,
} from "@tauri-apps/plugin-notification";
import { invoke } from "@tauri-apps/api/core";
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

      // Accept / Reject buttons on the "someone wants to send you files"
      // notification. Tapping the body just opens the app, where the prompt
      // is already waiting.
      if (
        extra?.kind === "incoming-request" &&
        typeof extra.requestId === "string" &&
        (action.actionId === "accept" || action.actionId === "reject")
      ) {
        void invoke("respond_to_file_transfer", {
          transferId: extra.requestId,
          accepted: action.actionId === "accept",
        }).catch((error) => {
          console.warn("Notification response failed:", error);
          notifications.show({
            title: "Too late",
            message: "That request is no longer active.",
            color: "yellow",
            autoClose: 3000,
          });
        });
        return;
      }

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

    void registerActionTypes([
      {
        id: "incoming-request",
        actions: [
          { id: "accept", title: "Accept", foreground: true },
          { id: "reject", title: "Reject", foreground: true },
        ],
      },
    ]).catch((error) => {
      console.error("Failed to register notification actions:", error);
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
