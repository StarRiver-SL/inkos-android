import { describe, expect, it, vi } from "vitest";

import {
  isMemoryIndexBusyError,
  isMemoryIndexUnavailableError,
  withMemoryIndexRetry,
} from "../pipeline/memory-index-sync.js";

describe("memory index sync helpers", () => {
  it("recognizes unavailable node:sqlite errors", () => {
    expect(isMemoryIndexUnavailableError(new Error("No such built-in module: node:sqlite"))).toBe(true);
    expect(isMemoryIndexUnavailableError(Object.assign(new Error("node:sqlite"), {
      code: "ERR_UNKNOWN_BUILTIN_MODULE",
    }))).toBe(true);
    expect(isMemoryIndexUnavailableError(new Error("database is locked"))).toBe(false);
  });

  it("recognizes busy sqlite errors", () => {
    expect(isMemoryIndexBusyError(Object.assign(new Error("busy"), { code: "SQLITE_BUSY" }))).toBe(true);
    expect(isMemoryIndexBusyError(new Error("database is locked"))).toBe(true);
    expect(isMemoryIndexBusyError(new Error("No such built-in module: node:sqlite"))).toBe(false);
  });

  it("retries transient busy errors", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "SQLITE_BUSY" }))
      .mockResolvedValue("ok");

    await expect(withMemoryIndexRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
