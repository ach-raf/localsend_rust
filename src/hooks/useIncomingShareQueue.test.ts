/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeShare,
  listenIncomingShares,
  type IncomingShare,
} from "tauri-plugin-android-share-target-api";
import { useIncomingShareQueue } from "./useIncomingShareQueue";

vi.mock("tauri-plugin-android-share-target-api", () => ({
  acknowledgeShare: vi.fn(),
  listenIncomingShares: vi.fn(),
}));

type ShareCallback = (share: IncomingShare) => void | Promise<void>;

const mockedAcknowledgeShare = vi.mocked(acknowledgeShare);
const mockedListenIncomingShares = vi.mocked(listenIncomingShares);

function share(id: string): IncomingShare {
  return {
    id,
    receivedAt: 1,
    mimeType: "video/mp4",
    text: null,
    htmlText: null,
    subject: null,
    files: [],
  };
}

describe("useIncomingShareQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes once and keeps delivered shares in deduplicated FIFO order", async () => {
    let deliver: ShareCallback | undefined;
    const unlisten = vi.fn();
    mockedListenIncomingShares.mockImplementation(async (callback) => {
      deliver = callback;
      return unlisten;
    });

    const { result, unmount } = renderHook(() => useIncomingShareQueue(true));
    await waitFor(() => expect(mockedListenIncomingShares).toHaveBeenCalledOnce());

    await act(async () => {
      await deliver?.(share("first"));
      await deliver?.(share("second"));
      await deliver?.(share("first"));
    });

    expect(result.current.shares.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
    expect(result.current.currentShare?.id).toBe("first");

    unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("removes local state when acknowledgement says the item was already absent", async () => {
    let deliver: ShareCallback | undefined;
    mockedListenIncomingShares.mockImplementation(async (callback) => {
      deliver = callback;
      return vi.fn();
    });
    mockedAcknowledgeShare.mockResolvedValue(false);

    const { result } = renderHook(() => useIncomingShareQueue(true));
    await waitFor(() => expect(deliver).toBeDefined());
    await act(async () => {
      await deliver?.(share("first"));
    });

    await act(async () => {
      await expect(result.current.acknowledge("first")).resolves.toBe(false);
    });

    expect(result.current.shares).toEqual([]);
  });

  it("keeps local state when acknowledgement fails", async () => {
    let deliver: ShareCallback | undefined;
    mockedListenIncomingShares.mockImplementation(async (callback) => {
      deliver = callback;
      return vi.fn();
    });
    mockedAcknowledgeShare.mockRejectedValue(new Error("bridge failed"));

    const { result } = renderHook(() => useIncomingShareQueue(true));
    await waitFor(() => expect(deliver).toBeDefined());
    await act(async () => {
      await deliver?.(share("first"));
    });

    await act(async () => {
      await expect(result.current.acknowledge("first")).rejects.toThrow(
        "bridge failed",
      );
    });

    expect(result.current.shares.map((item) => item.id)).toEqual(["first"]);
  });

  it("unregisters a listener that resolves after unmount", async () => {
    let resolveListener: ((unlisten: () => void) => void) | undefined;
    mockedListenIncomingShares.mockReturnValue(
      new Promise((resolve) => {
        resolveListener = resolve;
      }),
    );

    const { unmount } = renderHook(() => useIncomingShareQueue(true));
    await waitFor(() => expect(resolveListener).toBeDefined());
    unmount();

    const unlisten = vi.fn();
    await act(async () => {
      resolveListener?.(unlisten);
      await Promise.resolve();
    });

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("does not initialize the Android listener when disabled", () => {
    const { result } = renderHook(() => useIncomingShareQueue(false));

    expect(mockedListenIncomingShares).not.toHaveBeenCalled();
    expect(result.current.shares).toEqual([]);
    expect(result.current.currentShare).toBeNull();
  });
});
