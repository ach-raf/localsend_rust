import { describe, expect, it } from "vitest";
import {
  enqueueRequest,
  formatFileSize,
  removeRequest,
  type IncomingRequest,
} from "./incomingRequests";

const req = (id: string): IncomingRequest => ({
  id,
  kind: "file",
  senderAlias: "Peer",
  senderIp: "192.168.1.9",
  files: [{ name: "a.txt", size: 1 }],
});

describe("incoming request queue", () => {
  it("keeps requests in arrival order and ignores duplicates", () => {
    let queue: IncomingRequest[] = [];
    queue = enqueueRequest(queue, req("a"));
    queue = enqueueRequest(queue, req("b"));
    queue = enqueueRequest(queue, req("a"));
    expect(queue.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("drops only the cancelled request", () => {
    const queue = [req("a"), req("b"), req("c")];
    expect(removeRequest(queue, "b").map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("returns the same array when nothing was removed", () => {
    const queue = [req("a")];
    expect(removeRequest(queue, "zzz")).toBe(queue);
  });
});

describe("formatFileSize", () => {
  it("formats across units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});
