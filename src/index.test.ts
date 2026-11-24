import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "./index.js";

describe("Baseline Engine Test", () => {
  it("exports correct version", () => {
    expect(ENGINE_VERSION).toBe("0.1.0");
  });
});
