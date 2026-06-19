export interface ChatBackgroundSettings {
  readonly imageUrl: string | null;
  readonly opacity: number;
  readonly scale: number;
  readonly rotate: number;
  readonly x: number;
  readonly y: number;
}

export const CHAT_BACKGROUND_STORAGE_KEY = "inkos.chat.background.v1";

export const DEFAULT_CHAT_BACKGROUND: ChatBackgroundSettings = {
  imageUrl: null,
  opacity: 0.22,
  scale: 112,
  rotate: 0,
  x: 50,
  y: 50,
};

function parseSettings(raw: string | null): ChatBackgroundSettings {
  if (typeof window === "undefined") return DEFAULT_CHAT_BACKGROUND;
  try {
    const parsed = JSON.parse(raw ?? "null") as Partial<ChatBackgroundSettings> | null;
    return {
      ...DEFAULT_CHAT_BACKGROUND,
      ...parsed,
      imageUrl: typeof parsed?.imageUrl === "string" ? parsed.imageUrl : null,
    };
  } catch {
    return DEFAULT_CHAT_BACKGROUND;
  }
}

/** Read wallpaper for a specific session; falls back to global wallpaper. */
export function readChatBackground(sessionId?: string | null): ChatBackgroundSettings {
  if (typeof window === "undefined") return DEFAULT_CHAT_BACKGROUND;
  if (sessionId) {
    const sessionKey = `${CHAT_BACKGROUND_STORAGE_KEY}:${sessionId}`;
    const sessionRaw = window.localStorage.getItem(sessionKey);
    if (sessionRaw) return parseSettings(sessionRaw);
  }
  return parseSettings(window.localStorage.getItem(CHAT_BACKGROUND_STORAGE_KEY));
}

/** Write wallpaper for a specific session. Pass null/undefined to write globally. */
export function writeChatBackground(settings: ChatBackgroundSettings, sessionId?: string | null): void {
  if (typeof window === "undefined") return;
  const key = sessionId ? `${CHAT_BACKGROUND_STORAGE_KEY}:${sessionId}` : CHAT_BACKGROUND_STORAGE_KEY;
  window.localStorage.setItem(key, JSON.stringify(settings));
}

export function selectChatBackground(imageUrl: string, sessionId?: string | null): ChatBackgroundSettings {
  const settings = { ...DEFAULT_CHAT_BACKGROUND, imageUrl };
  writeChatBackground(settings, sessionId);
  return settings;
}

export function clearChatBackground(sessionId?: string | null): ChatBackgroundSettings {
  writeChatBackground(DEFAULT_CHAT_BACKGROUND, sessionId);
  return DEFAULT_CHAT_BACKGROUND;
}
