import { MemoryDB, type Fact } from "../state/memory-db.js";
import { loadNarrativeMemorySeed, loadSnapshotCurrentStateFacts } from "../state/runtime-state-store.js";
import { rewriteStructuredStateFromMarkdown } from "../state/state-bootstrap.js";
import type { WriteChapterOutput } from "../agents/writer.js";

export async function syncLegacyStructuredStateFromMarkdown(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly output?: {
    readonly runtimeStateDelta?: WriteChapterOutput["runtimeStateDelta"];
    readonly runtimeStateSnapshot?: WriteChapterOutput["runtimeStateSnapshot"];
  };
}): Promise<void> {
  if (params.output?.runtimeStateDelta || params.output?.runtimeStateSnapshot) {
    return;
  }

  await rewriteStructuredStateFromMarkdown({
    bookDir: params.bookDir,
    fallbackChapter: params.chapterNumber,
  });
}

export async function rebuildCurrentStateFactHistory(bookDir: string, uptoChapter: number): Promise<void> {
  const memoryDb = await withMemoryIndexRetry(async () => {
    const db = new MemoryDB(bookDir);
    try {
      db.resetFacts();

      const activeFacts = new Map<string, { id: number; object: string }>();

      for (let chapter = 0; chapter <= uptoChapter; chapter++) {
        const snapshotFacts = await loadSnapshotCurrentStateFacts(bookDir, chapter);
        if (snapshotFacts.length === 0) continue;
        const nextFacts = new Map<string, Omit<Fact, "id">>();

        for (const fact of snapshotFacts) {
          nextFacts.set(factKey(fact), {
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            validFromChapter: chapter,
            validUntilChapter: null,
            sourceChapter: chapter,
          });
        }

        for (const [key, previous] of activeFacts.entries()) {
          const next = nextFacts.get(key);
          if (!next || next.object !== previous.object) {
            db.invalidateFact(previous.id, chapter);
            activeFacts.delete(key);
          }
        }

        for (const [key, fact] of nextFacts.entries()) {
          if (activeFacts.has(key)) continue;
          const id = db.addFact(fact);
          activeFacts.set(key, { id, object: fact.object });
        }
      }

      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  });

  try {
    // No-op: keep the db open only for the duration of the rebuild.
  } finally {
    memoryDb.close();
  }
}

export async function rebuildNarrativeMemoryIndex(bookDir: string): Promise<void> {
  const memorySeed = await loadNarrativeMemorySeed(bookDir);

  const memoryDb = await withMemoryIndexRetry(() => {
    const db = new MemoryDB(bookDir);
    try {
      db.replaceSummaries(memorySeed.summaries);
      db.replaceHooks(memorySeed.hooks);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  });

  try {
    // No-op: keep the db open only for the duration of the rebuild.
  } finally {
    memoryDb.close();
  }
}

export function canOpenMemoryIndex(bookDir: string): boolean {
  let memoryDb: MemoryDB | null = null;
  try {
    memoryDb = new MemoryDB(bookDir);
    return true;
  } catch {
    return false;
  } finally {
    memoryDb?.close();
  }
}

export async function withMemoryIndexRetry<T>(operation: () => Promise<T> | T): Promise<T> {
  const retryDelaysMs = [0, 25, 75];
  let lastError: unknown;

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isMemoryIndexBusyError(error) || attempt === retryDelaysMs.length - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt + 1]!));
    }
  }

  throw lastError;
}

export function isMemoryIndexUnavailableError(error: unknown): boolean {
  if (!error) return false;

  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error
    ? error.message
    : String(error);
  const normalizedMessage = message.trim();

  return /^No such built-in module:\s*node:sqlite$/i.test(normalizedMessage)
    || /^Cannot find module ['"]node:sqlite['"]$/i.test(normalizedMessage)
    || (code === "ERR_UNKNOWN_BUILTIN_MODULE" && /\bnode:sqlite\b/i.test(normalizedMessage));
}

export function isMemoryIndexBusyError(error: unknown): boolean {
  if (!error) return false;

  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error
    ? error.message
    : String(error);

  return code === "SQLITE_BUSY"
    || code === "SQLITE_LOCKED"
    || /\bSQLITE_BUSY\b/i.test(message)
    || /\bSQLITE_LOCKED\b/i.test(message)
    || /database is locked/i.test(message)
    || /database is busy/i.test(message);
}

function factKey(fact: Pick<Fact, "subject" | "predicate">): string {
  return `${fact.subject}::${fact.predicate}`;
}
