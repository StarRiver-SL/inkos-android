import { describe, expect, it, vi } from "vitest";
import { createImeCommitScheduler } from "./use-android-ime-bridge";

describe("createImeCommitScheduler", () => {
  it("runs immediate and delayed IME commit checks", () => {
    const sync = vi.fn();
    const microtasks: Array<() => void> = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const scheduler = createImeCommitScheduler(sync, {
      queueMicrotask: (callback) => microtasks.push(callback),
      setTimeout: (callback) => {
        const timer = nextTimer++;
        timers.set(timer, callback);
        return timer;
      },
      clearTimeout: (timer) => {
        timers.delete(timer);
      },
    });

    scheduler.syncAfterCommit();
    expect(sync).toHaveBeenCalledTimes(1);
    microtasks.splice(0).forEach((callback) => callback());
    [...timers.values()].forEach((callback) => callback());
    expect(sync).toHaveBeenCalledTimes(4);
  });

  it("cancels stale callbacks when the bridge is disposed", () => {
    const sync = vi.fn();
    const microtasks: Array<() => void> = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const scheduler = createImeCommitScheduler(sync, {
      queueMicrotask: (callback) => microtasks.push(callback),
      setTimeout: (callback) => {
        const timer = nextTimer++;
        timers.set(timer, callback);
        return timer;
      },
      clearTimeout: (timer) => {
        timers.delete(timer);
      },
    });

    scheduler.syncAfterCommit();
    scheduler.dispose();
    microtasks.splice(0).forEach((callback) => callback());
    [...timers.values()].forEach((callback) => callback());

    expect(sync).toHaveBeenCalledTimes(1);
    expect(timers.size).toBe(0);
  });
});
