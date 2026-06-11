/**
 * useCompositionInput - 现代化的 IME composition 处理 hook
 *
 * 基于 react-composition-input 的核心思想，使用 React hooks 重写。
 * 解决中文/日文等输入法在 composition 期间触发 onChange 的问题。
 *
 * 核心原理：
 * - 在 compositionstart 时标记进入组合状态
 * - 在 composition 结束前，阻止向父组件同步值
 * - compositionend 时才触发最终的值同步
 *
 * @see https://github.com/LeoEatle/react-composition-input
 * @see https://github.com/facebook/react/issues/8683
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
} from "react";

export interface UseCompositionInputOptions {
  /** 受控值 */
  value?: string;
  /** 初始值（非受控模式） */
  defaultValue?: string;
  /** 值变化回调 - 仅在 composition 完成后或非 IME 输入时触发 */
  onValueChange: (value: string) => void;
  /** 每次输入变化都触发（包括 composition 期间） */
  onChange?: (value: string) => void;
}

export interface UseCompositionInputReturn {
  /** 当前显示值 */
  value: string;
  /** 绑定到 input/textarea 的 onChange */
  handleChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** Android WebView fallback: 绑定到 input/textarea 的 onInput */
  handleInput: (e: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** 绑定到 input/textarea 的 onCompositionStart */
  handleCompositionStart: (e: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** 绑定到 input/textarea 的 onCompositionEnd */
  handleCompositionEnd: (e: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** 是否正在 composition 中 */
  isComposing: boolean;
  /** 手动设置值 */
  setValue: (value: string) => void;
}

/**
 * 处理 IME composition 的输入 hook
 *
 * @example
 * ```tsx
 * const { value, handleChange, handleCompositionStart, handleCompositionEnd } = useCompositionInput({
 *   value: inputValue,
 *   onValueChange: setInputValue,
 * });
 *
 * return (
 *   <textarea
 *     value={value}
 *     onChange={handleChange}
 *     onCompositionStart={handleCompositionStart}
 *     onCompositionEnd={handleCompositionEnd}
 *   />
 * );
 * ```
 */
export function useCompositionInput(options: UseCompositionInputOptions): UseCompositionInputReturn {
  const { value: controlledValue, defaultValue, onValueChange, onChange } = options;

  // 内部状态（用于非受控模式或 composition 期间的临时值）
  const [internalValue, setInternalValue] = useState(controlledValue ?? defaultValue ?? "");

  // 使用 ref 追踪 composition 状态，避免闭包问题
  const isComposingRef = useRef(false);
  const [isComposing, setIsComposing] = useState(false);

  const lastEmittedValueRef = useRef(internalValue);

  // 外部清空或切换会话时再同步。不要在 render 期间 setState，
  // Android WebView 的 IME 正在提交候选词时尤其容易被旧值覆盖。
  useEffect(() => {
    if (controlledValue === undefined || isComposingRef.current) return;
    setInternalValue((current) => current === controlledValue ? current : controlledValue);
    lastEmittedValueRef.current = controlledValue;
  }, [controlledValue]);

  const commitValue = useCallback((newValue: string) => {
    setInternalValue(newValue);
    if (lastEmittedValueRef.current === newValue) return;
    lastEmittedValueRef.current = newValue;
    onValueChange(newValue);
    onChange?.(newValue);
  }, [onValueChange, onChange]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const nextValue = e.currentTarget.value;
      if (isComposingRef.current) {
        setInternalValue(nextValue);
        return;
      }
      commitValue(nextValue);
    },
    [commitValue]
  );

  const handleInput = useCallback(
    (e: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const nextValue = e.currentTarget.value;
      if (isComposingRef.current) {
        setInternalValue(nextValue);
        return;
      }
      commitValue(nextValue);
    },
    [commitValue],
  );

  const handleCompositionStart = useCallback(
    (e: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      isComposingRef.current = true;
      setIsComposing(true);
      setInternalValue(e.currentTarget.value);
    },
    []
  );

  const handleCompositionEnd = useCallback(
    (e: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      isComposingRef.current = false;
      setIsComposing(false);
      const target = e.currentTarget;
      commitValue(target.value);
      // Some Android keyboards update textarea.value immediately after
      // compositionend. Read it once more in a microtask to capture that commit.
      queueMicrotask(() => commitValue(target.value));
    },
    [commitValue]
  );

  const setValue = useCallback(
    (newValue: string) => {
      commitValue(newValue);
    },
    [commitValue]
  );

  return {
    value: internalValue,
    handleChange,
    handleInput,
    handleCompositionStart,
    handleCompositionEnd,
    isComposing,
    setValue,
  };
}
