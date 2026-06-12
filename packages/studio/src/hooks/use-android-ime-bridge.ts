import { useEffect, type RefObject } from "react";

interface AndroidImeBridgeOptions {
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly sessionId: string | null;
  readonly setDisplayValue: (value: string) => void;
  readonly commitValue: (value: string) => void;
}

interface ImeCommitScheduler {
  queueMicrotask(callback: () => void): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timer: number): void;
}

export function createImeCommitScheduler(
  sync: () => void,
  scheduler: ImeCommitScheduler,
): { syncAfterCommit: () => void; dispose: () => void } {
  let disposed = false;
  const timers = new Set<number>();
  const run = () => {
    if (!disposed) sync();
  };
  const schedule = (delay: number) => {
    const timer = scheduler.setTimeout(() => {
      timers.delete(timer);
      run();
    }, delay);
    timers.add(timer);
  };

  return {
    syncAfterCommit: () => {
      run();
      scheduler.queueMicrotask(run);
      schedule(0);
      schedule(32);
    },
    dispose: () => {
      disposed = true;
      for (const timer of timers) scheduler.clearTimeout(timer);
      timers.clear();
    },
  };
}

export function useAndroidImeBridge({
  textareaRef,
  sessionId,
  setDisplayValue,
  commitValue,
}: AndroidImeBridgeOptions): void {
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    let focused = document.activeElement === element;
    let composing = false;
    let timer: number | null = null;
    let lastSeenValue = element.value;
    let lastCommittedValue = element.value;

    const resize = () => {
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
    };
    const syncFromDom = (mode: "display" | "commit") => {
      const next = element.value;
      if (mode === "display") {
        if (next === lastSeenValue) return;
        lastSeenValue = next;
        setDisplayValue(next);
      } else {
        lastSeenValue = next;
        if (next === lastCommittedValue) return;
        lastCommittedValue = next;
        commitValue(next);
      }
      resize();
    };
    const imeCommitScheduler = createImeCommitScheduler(
      () => syncFromDom("commit"),
      {
        queueMicrotask,
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: (pendingTimer) => window.clearTimeout(pendingTimer),
      },
    );
    const poll = () => {
      if (!focused) {
        timer = null;
        return;
      }
      syncFromDom(composing ? "display" : "commit");
      timer = window.setTimeout(poll, composing ? 80 : 160);
    };
    const onFocus = () => {
      focused = true;
      lastSeenValue = element.value;
      lastCommittedValue = element.value;
      if (timer === null) timer = window.setTimeout(poll, 80);
    };
    const onBlur = () => {
      imeCommitScheduler.syncAfterCommit();
      focused = false;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const onCompositionStart = () => {
      composing = true;
    };
    const onInput = () => {
      if (composing) {
        syncFromDom("display");
        return;
      }
      imeCommitScheduler.syncAfterCommit();
    };
    const onCompositionEnd = () => {
      composing = false;
      imeCommitScheduler.syncAfterCommit();
    };

    element.addEventListener("focus", onFocus);
    element.addEventListener("blur", onBlur);
    element.addEventListener("compositionstart", onCompositionStart);
    element.addEventListener("input", onInput);
    element.addEventListener("compositionend", onCompositionEnd);
    if (focused) timer = window.setTimeout(poll, 80);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      imeCommitScheduler.dispose();
      element.removeEventListener("focus", onFocus);
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("compositionstart", onCompositionStart);
      element.removeEventListener("input", onInput);
      element.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [commitValue, sessionId, setDisplayValue, textareaRef]);
}
