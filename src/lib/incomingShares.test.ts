import { describe, expect, it, vi } from "vitest";
import type { IncomingShare } from "tauri-plugin-android-share-target-api";
import {
  createIncomingShareProgress,
  forwardIncomingShare,
  getIncomingShareText,
} from "./incomingShares";

const peer = { ip: "192.168.1.20", port: 3030, alias: "Peer" };

function share(overrides: Partial<IncomingShare> = {}): IncomingShare {
  return {
    id: "share-1",
    receivedAt: 1,
    mimeType: "image/jpeg",
    text: null,
    htmlText: null,
    subject: null,
    files: [],
    ...overrides,
  };
}

describe("getIncomingShareText", () => {
  it("preserves a distinct subject with the shared text", () => {
    expect(
      getIncomingShareText(share({ subject: "Trip", text: "The photos" })),
    ).toBe("Trip\n\nThe photos");
  });

  it("falls back to HTML text when plain text is absent", () => {
    expect(getIncomingShareText(share({ htmlText: "<b>Hello</b>" }))).toBe(
      "<b>Hello</b>",
    );
  });
});

describe("forwardIncomingShare", () => {
  it("sends files then text and acknowledges only after both succeed", async () => {
    const calls: string[] = [];
    const actions = {
      sendFiles: vi.fn(async () => void calls.push("files")),
      sendText: vi.fn(async () => void calls.push("text")),
      acknowledge: vi.fn(async () => {
        calls.push("acknowledge");
        return true;
      }),
    };
    const incoming = share({
      text: "Caption",
      files: [
        {
          uri: "content://provider/photo",
          mimeType: "image/jpeg",
          displayName: "photo.jpg",
          size: 42,
        },
      ],
    });

    await forwardIncomingShare(
      incoming,
      peer,
      createIncomingShareProgress(),
      actions,
    );

    expect(calls).toEqual(["files", "text", "acknowledge"]);
    expect(actions.sendFiles).toHaveBeenCalledWith(peer, [
      "content://provider/photo",
    ]);
    expect(actions.sendText).toHaveBeenCalledWith(peer, "Caption");
  });

  it("keeps completed files marked so retry does not send them twice", async () => {
    const progress = createIncomingShareProgress();
    const sendFiles = vi.fn(async () => undefined);
    const sendText = vi
      .fn()
      .mockRejectedValueOnce(new Error("text failed"))
      .mockResolvedValueOnce(undefined);
    const acknowledge = vi.fn(async () => true);
    const incoming = share({
      text: "Caption",
      files: [
        {
          uri: "content://provider/photo",
          mimeType: "image/jpeg",
          displayName: "photo.jpg",
          size: 42,
        },
      ],
    });
    const actions = { sendFiles, sendText, acknowledge };

    await expect(
      forwardIncomingShare(incoming, peer, progress, actions),
    ).rejects.toThrow("text failed");
    await forwardIncomingShare(incoming, peer, progress, actions);

    expect(sendFiles).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it("resends completed parts when retrying with a different peer", async () => {
    const progress = createIncomingShareProgress();
    const sendFiles = vi.fn(async () => undefined);
    const sendText = vi
      .fn()
      .mockRejectedValueOnce(new Error("text failed"))
      .mockResolvedValueOnce(undefined);
    const acknowledge = vi.fn(async () => true);
    const incoming = share({
      text: "Caption",
      files: [
        {
          uri: "content://provider/photo",
          mimeType: "image/jpeg",
          displayName: "photo.jpg",
          size: 42,
        },
      ],
    });
    const actions = { sendFiles, sendText, acknowledge };

    await expect(
      forwardIncomingShare(incoming, peer, progress, actions),
    ).rejects.toThrow("text failed");
    await forwardIncomingShare(
      incoming,
      { ip: "192.168.1.30", port: 3030, alias: "Other peer" },
      progress,
      actions,
    );

    expect(sendFiles).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it("does not acknowledge when file sending fails", async () => {
    const actions = {
      sendFiles: vi.fn(async () => {
        throw new Error("upload failed");
      }),
      sendText: vi.fn(async () => undefined),
      acknowledge: vi.fn(async () => true),
    };

    await expect(
      forwardIncomingShare(
        share({
          files: [
            {
              uri: "content://provider/file",
              mimeType: null,
              displayName: null,
              size: null,
            },
          ],
        }),
        peer,
        createIncomingShareProgress(),
        actions,
      ),
    ).rejects.toThrow("upload failed");

    expect(actions.acknowledge).not.toHaveBeenCalled();
  });

  it("rejects when the native queue does not remove the share", async () => {
    const actions = {
      sendFiles: vi.fn(async () => undefined),
      sendText: vi.fn(async () => undefined),
      acknowledge: vi.fn(async () => false),
    };

    await expect(
      forwardIncomingShare(
        share({ text: "Hello" }),
        peer,
        createIncomingShareProgress(),
        actions,
      ),
    ).rejects.toThrow("could not be removed");
  });
});
