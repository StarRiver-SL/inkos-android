import { afterEach, describe, expect, it } from "vitest";
import { HeadroomMcpManager } from "./headroom-mcp";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("HeadroomMcpManager", () => {
  it("uses bundled Headroom-compatible compression on Android without spawning the external command", async () => {
    process.env.INKOS_ANDROID = "1";
    delete process.env.INKOS_HEADROOM_MODE;
    delete process.env.INKOS_HEADROOM_COMMAND;

    const manager = new HeadroomMcpManager();
    const status = await manager.check();
    expect(status).toMatchObject({
      mode: "bundled",
      state: "online",
      tools: ["headroom_compress", "headroom_retrieve", "headroom_stats"],
      lastError: null,
    });

    const compressed = await manager.compress(`# Story Bible\n## Cast\n${"long context ".repeat(900)}`);
    expect(compressed?.compressed).toContain("Bundled Headroom-compatible compression");
    expect(compressed?.compressed).toContain("## Cast");
    expect(manager.getStatus().session.compressions).toBe(1);
    expect(manager.getStatus().lastCompressionOk).toBe(true);
  });

  it("can force the external MCP mode on desktop builds", async () => {
    delete process.env.INKOS_ANDROID;
    process.env.INKOS_HEADROOM_MODE = "external-mcp";

    const manager = new HeadroomMcpManager();
    expect(manager.getStatus()).toMatchObject({
      mode: "external-mcp",
      state: "idle",
      command: "headroom",
    });
  });
});
