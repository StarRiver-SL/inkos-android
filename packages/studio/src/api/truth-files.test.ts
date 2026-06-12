import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listBookTruthFiles,
  listTruthFileHistory,
  resolveTruthFilePath,
} from "./truth-files.js";

describe("truth file helpers", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "inkos-truth-files-"));
    await mkdir(join(bookDir, "story"), { recursive: true });
  });

  afterEach(async () => {
    await rm(bookDir, { force: true, recursive: true });
  });

  it("allows declared truth paths and rejects traversal", () => {
    expect(resolveTruthFilePath(bookDir, "current_state.md")).toBe(
      join(bookDir, "story", "current_state.md"),
    );
    expect(resolveTruthFilePath(bookDir, "roles/major/Alice.md")).toBe(
      join(bookDir, "story", "roles", "major", "Alice.md"),
    );
    expect(resolveTruthFilePath(bookDir, "runtime/chapter-0001.trace.json")).toBe(
      join(bookDir, "story", "runtime", "chapter-0001.trace.json"),
    );

    expect(resolveTruthFilePath(bookDir, "../book.json")).toBeNull();
    expect(resolveTruthFilePath(bookDir, "roles/major/../Alice.md")).toBeNull();
    expect(resolveTruthFilePath(bookDir, "runtime/other.json")).toBeNull();
  });

  it("lists snapshot history from newest chapter to oldest", async () => {
    await mkdir(join(bookDir, "story", "snapshots", "1"), { recursive: true });
    await mkdir(join(bookDir, "story", "snapshots", "3"), { recursive: true });
    await writeFile(
      join(bookDir, "story", "snapshots", "1", "current_state.md"),
      "chapter one",
      "utf-8",
    );
    await writeFile(
      join(bookDir, "story", "snapshots", "3", "current_state.md"),
      "chapter three",
      "utf-8",
    );

    await expect(listTruthFileHistory(bookDir, "current_state.md")).resolves.toEqual([
      { chapter: 3, size: "chapter three".length, preview: "chapter three" },
      { chapter: 1, size: "chapter one".length, preview: "chapter one" },
    ]);
  });

  it("lists browser entries for outline, role, runtime, and state files", async () => {
    await mkdir(join(bookDir, "story", "outline"), { recursive: true });
    await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });
    await mkdir(join(bookDir, "story", "runtime"), { recursive: true });
    await mkdir(join(bookDir, "story", "state"), { recursive: true });
    await writeFile(join(bookDir, "story", "current_state.md"), "state", "utf-8");
    await writeFile(join(bookDir, "story", "private_notes.md"), "private", "utf-8");
    await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "frame", "utf-8");
    await writeFile(join(bookDir, "story", "outline", "scratch.md"), "scratch", "utf-8");
    await writeFile(join(bookDir, "story", "roles", "major", "Alice.md"), "alice", "utf-8");
    await writeFile(
      join(bookDir, "story", "runtime", "chapter-0001.trace.json"),
      "trace",
      "utf-8",
    );
    await writeFile(join(bookDir, "story", "state", "manifest.json"), "manifest", "utf-8");

    const files = await listBookTruthFiles(bookDir);

    expect(files.map((file) => file.name).sort()).toEqual([
      "current_state.md",
      "outline/story_frame.md",
      "roles/major/Alice.md",
      "runtime/chapter-0001.trace.json",
      "state/manifest.json",
    ]);
    expect(files.find((file) => file.name === "runtime/chapter-0001.trace.json")).toMatchObject({
      readonly: true,
      readonlyReason: "runtime-diagnostic",
    });
    expect(files.find((file) => file.name === "state/manifest.json")).toMatchObject({
      readonly: true,
      readonlyReason: "runtime-state",
    });
    expect(files.some((file) => file.name === "private_notes.md")).toBe(false);
    expect(files.some((file) => file.name === "outline/scratch.md")).toBe(false);
  });
});
