import { describe, expect, it, vi } from "vitest";
import { BaseAgent } from "../agents/base.js";
import * as provider from "../llm/provider.js";

class TestAgent extends BaseAgent {
  get name(): string {
    return "state-validator";
  }

  run(): Promise<provider.LLMResponse> {
    return this.chat([{ role: "user", content: "ping" }]);
  }
}

describe("BaseAgent LLM errors", () => {
  it("identifies the failing agent route in multi-agent pipelines", async () => {
    vi.spyOn(provider, "chatCompletion").mockRejectedValueOnce(
      new Error("无法连接到 API 服务。"),
    );
    const agent = new TestAgent({
      client: {
        provider: "openai",
        service: "custom",
        apiFormat: "chat",
        stream: true,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          extra: {},
        },
        _piModel: {
          id: "mimo-v2-omni",
          name: "mimo-v2-omni",
          api: "openai-completions",
          provider: "openai",
          baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262144,
          maxTokens: 65536,
        },
      },
      model: "mimo-v2-omni",
      projectRoot: process.cwd(),
    });

    await expect(agent.run()).rejects.toThrow(
      /Agent "state-validator" request failed .*model=mimo-v2-omni.*token-plan-cn/s,
    );
  });
});
