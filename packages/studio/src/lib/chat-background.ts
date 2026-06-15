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

export function readChatBackground(): ChatBackgroundSettings {
  if (typeof window === "undefined") return DEFAULT_CHAT_BACKGROUND;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CHAT_BACKGROUND_STORAGE_KEY) ?? "null",
    ) as Partial<ChatBackgroundSettings> | null;
    return {
      ...DEFAULT_CHAT_BACKGROUND,
      ...parsed,
      imageUrl: typeof parsed?.imageUrl === "string" ? parsed.imageUrl : null,
    };
  } catch {
    return DEFAULT_CHAT_BACKGROUND;
  }
}

export function writeChatBackground(settings: ChatBackgroundSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHAT_BACKGROUND_STORAGE_KEY, JSON.stringify(settings));
}

export function selectChatBackground(imageUrl: string): ChatBackgroundSettings {
  const settings = { ...DEFAULT_CHAT_BACKGROUND, imageUrl };
  writeChatBackground(settings);
  return settings;
}

export function clearChatBackground(): ChatBackgroundSettings {
  writeChatBackground(DEFAULT_CHAT_BACKGROUND);
  return DEFAULT_CHAT_BACKGROUND;
}
