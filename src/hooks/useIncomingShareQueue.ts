import { useCallback, useEffect, useState } from "react";
import {
  acknowledgeShare,
  getPendingShares,
  listenIncomingShares,
  type IncomingShare,
} from "tauri-plugin-android-share-target-api";
import {
  enqueueIncomingShare,
  removeIncomingShare,
} from "../lib/incomingShares";

export interface IncomingShareQueue {
  shares: IncomingShare[];
  currentShare: IncomingShare | null;
  acknowledge(id: string): Promise<boolean>;
}

export function useIncomingShareQueue(enabled: boolean): IncomingShareQueue {
  const [shares, setShares] = useState<IncomingShare[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let stopListening: (() => void) | undefined;

    void listenIncomingShares((share) => {
      if (!disposed) {
        setShares((current) => enqueueIncomingShare(current, share));
      }
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          stopListening = unlisten;
        }
      })
      .catch((error) => {
        if (!disposed) {
          console.error("Failed to initialize Android share target:", error);
        }
      });

    // Safety net: the native "share available" event can fire before the
    // webview is listening (cold start from another app). The native queue is
    // authoritative, so re-read it whenever the app comes back to the front.
    const resync = () => {
      if (document.visibilityState !== "visible") return;
      getPendingShares()
        .then((pending) => {
          if (disposed) return;
          setShares((current) =>
            pending.reduce(
              (acc, share) => enqueueIncomingShare(acc, share),
              current,
            ),
          );
        })
        .catch((error) => console.error("Failed to resync shares:", error));
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
      stopListening?.();
    };
  }, [enabled]);

  const acknowledge = useCallback(async (id: string) => {
    const removed = await acknowledgeShare(id);
    setShares((current) => removeIncomingShare(current, id));
    return removed;
  }, []);

  return {
    shares,
    currentShare: shares[0] ?? null,
    acknowledge,
  };
}
