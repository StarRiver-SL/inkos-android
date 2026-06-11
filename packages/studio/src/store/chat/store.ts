import { create } from "zustand";
import type { ChatStore } from "./types";
import { initialChatState } from "./initialState";
import { createMessageSlice } from "./slices/message/action";
import { createCreateSlice } from "./slices/create/action";
import { loadPersistedMessageState, persistMessageState } from "./persistence";

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastPersistedKey = "";

function schedulePersist(state: ChatStore): void {
  if (typeof window === "undefined") return;
  const activeSession = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
  if (activeSession?.isStreaming || activeSession?.stream) return;
  const key = JSON.stringify({
    activeSessionId: state.activeSessionId,
    input: state.input,
    selectedModel: state.selectedModel,
    selectedService: state.selectedService,
    sessionCount: Object.keys(state.sessions).length,
    activeMessageCount: activeSession?.messages.length ?? 0,
    activeLastMessageTs: activeSession?.messages.at(-1)?.timestamp ?? 0,
    activeDeletedCount: activeSession?.deletedMessageKeys?.length ?? 0,
  });
  if (key === lastPersistedKey) return;
  lastPersistedKey = key;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const current = useChatStore.getState();
    persistMessageState({
      sessions: current.sessions,
      sessionIdsByBook: current.sessionIdsByBook,
      activeSessionId: current.activeSessionId,
      input: current.input,
      selectedModel: current.selectedModel,
      selectedService: current.selectedService,
    });
  }, 300);
}

export const useChatStore = create<ChatStore>()((...a) => ({
  ...initialChatState,
  ...loadPersistedMessageState(),
  ...createMessageSlice(...a),
  ...createCreateSlice(...a),
}));

useChatStore.subscribe((state) => {
  schedulePersist(state);
});
