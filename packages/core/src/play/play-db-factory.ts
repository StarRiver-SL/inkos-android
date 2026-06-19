import { PlayDB } from "./play-db.js";
import { PlayFileDB, type PlayGraphSnapshot } from "./play-file-db.js";
import type { PlayReducerDB } from "./play-reducer.js";

export interface PlayGraphDB extends PlayReducerDB {
  readonly snapshot: () => PlayGraphSnapshot;
  readonly replaceWithSnapshot: (snapshot: PlayGraphSnapshot) => void;
  readonly close?: () => void;
}

export function createPlayDB(runDir: string): PlayGraphDB {
  try {
    return new PlayDB(runDir);
  } catch (error) {
    if (isSqliteUnavailableError(error)) {
      return new PlayFileDB(runDir);
    }
    throw error;
  }
}

function isSqliteUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // node:sqlite module missing (Node < 22.5)
  if (message.includes("node:sqlite") || message.includes("No such built-in module")) return true;
  // SQLite file open failures on Android external storage (FUSE/SELinux)
  if (message.includes("unable to open database file")) return true;
  // Generic SQLite initialization errors
  if (message.includes("ERR_SQLITE_ERROR")) return true;
  return false;
}
