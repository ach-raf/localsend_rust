import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  show: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./notifications", () => ({
  notifications: {
    show: mocks.show,
    update: mocks.update,
  },
}));

import { sendFilePathsToPeer } from "./fileTransfer";

const peer = { ip: "192.168.1.20", port: 3030, alias: "Peer" };

describe("sendFilePathsToPeer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when the receiving peer rejects the batch", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_file_metadata") {
        return { name: "photo.jpg", size: 42 };
      }
      if (command === "request_batch_transfer_to_peer") {
        return [false, "session-1"];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(
      sendFilePathsToPeer(peer, ["content://provider/photo"]),
    ).rejects.toThrow("rejected");
  });

  it("rejects when any file upload fails", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_file_metadata") {
        return { name: "photo.jpg", size: 42 };
      }
      if (command === "request_batch_transfer_to_peer") {
        return [true, "session-2"];
      }
      if (command === "send_file_to_peer") {
        throw new Error("network disconnected");
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(
      sendFilePathsToPeer(peer, ["content://provider/photo"]),
    ).rejects.toThrow("network disconnected");
  });
});
