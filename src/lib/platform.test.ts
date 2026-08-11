import { describe, expect, it, vi } from "vitest";
import { detectAndroid } from "./platform";

describe("detectAndroid", () => {
  it("returns the platform result", () => {
    expect(detectAndroid(() => true)).toBe(true);
    expect(detectAndroid(() => false)).toBe(false);
  });

  it("defaults to desktop when the platform API is unavailable", () => {
    const unavailable = vi.fn(() => {
      throw new Error("Android bridge is not injected");
    });

    expect(detectAndroid(unavailable)).toBe(false);
  });
});
