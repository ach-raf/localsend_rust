import { useCallback, useEffect, useState } from "react";
import {
  acknowledgeShare,
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

    return () => {
      disposed = true;
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
