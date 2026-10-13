import { RoutingError } from "./core/index.ts";
import type { NativeContextConfig } from "./core/index.ts";

interface TextMessage { readonly role: string; readonly content?: unknown; readonly timestamp?: number }
interface DialogueMessage { role: "user" | "assistant"; text: string; truncated: boolean }
export interface ContextSummary {
  taskChars: number;
  taskTruncated: boolean;
  historyMessages: number;
  historyChars: number;
  historyTruncated: boolean;
  stateBytes: number;
}
export interface NativeSelectorState {
  task: string;
  taskTruncated: boolean;
  hasImages: boolean;
  recentDialogue?: DialogueMessage[];
  dialogueTruncated?: boolean;
}
export function textOnly(message: TextMessage): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap(block => block?.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
}
/** Pi converts custom/summary/bash messages to users before routing. Admit only matching real dialogue
 * from the current projection, never recover compacted-away text from the raw session branch. */
export function projectedDialogue(messages: readonly TextMessage[], projection: readonly TextMessage[]): TextMessage[] {
  const key = (message: TextMessage) => JSON.stringify([message.role, message.timestamp, textOnly(message)]);
  const admitted = new Set(projection.filter(m => m.role === "user" || m.role === "assistant").map(key));
  return messages.filter(m => (m.role === "user" || m.role === "assistant") && admitted.has(key(m)));
}
export function contextOptions(config: NativeContextConfig = {}): Required<NativeContextConfig> {
  return { previousMessages: config.previousMessages ?? 3, maxHistoryChars: config.maxHistoryChars ?? 8000,
    maxMessageChars: config.maxMessageChars ?? 3000, includeAssistant: config.includeAssistant ?? false,
    truncation: config.truncation ?? "head-tail" };
}
const bytes = (state: NativeSelectorState) => Buffer.byteLength(JSON.stringify(state), "utf8");
const prefix = (text: string, size: number) => text.slice(0, size).replace(/[\uD800-\uDBFF]$/u, "");
const suffix = (text: string, size: number) => size <= 0 ? "" : text.slice(-size).replace(/^[\uDC00-\uDFFF]/u, "");
function excerpt(text: string, limit: number, mode: Required<NativeContextConfig>["truncation"]): string {
  if (text.length <= limit) return text;
  if (mode === "error") throw new RoutingError("INVALID_STATE", "Native routing text exceeds configured context budget; shorten the request or change nativeRouting.context");
  if (limit <= 0) return "";
  if (mode === "prefix") return prefix(text, limit);
  const head = Math.ceil((limit - 1) / 2);
  return `${prefix(text, head)}…${suffix(text, limit - 1 - head)}`;
}
/** Configuration is validated by parsePolicy. Character caps and the serialized-state cap are independent. */
export function buildNativeContext(messages: readonly TextMessage[], hasImages: boolean, config?: NativeContextConfig): { state: NativeSelectorState; summary: ContextSummary } {
  const current = messages.findLastIndex(m => m.role === "user");
  const task = current < 0 ? "" : textOnly(messages[current]!);
  if (!task.trim()) throw new RoutingError("INVALID_STATE", "Automatic selection requires a user task; select an explicit policy instead");
  const options = contextOptions(config);
  const state: NativeSelectorState = { task: config ? excerpt(task, options.maxMessageChars, options.truncation) : prefix(task, 3000), taskTruncated: false, hasImages };
  state.taskTruncated = state.task.length < task.length;
  if (config) {
    state.recentDialogue = [];
    state.dialogueTruncated = false;
    // Fit exact UTF-8 JSON bytes, not a chars/4 token heuristic. Bounded binary searches preserve
    // the same clipping policy even for escaping-heavy strings and multi-byte Unicode.
    const fit = (text: string, limit: number, assign: (text: string) => void) => {
      assign(excerpt(text, limit, options.truncation));
      if (bytes(state) <= 16384) return;
      if (options.truncation === "error") throw new RoutingError("INVALID_STATE", "Native routing state exceeds 16 KiB; shorten the request or change nativeRouting.context");
      let low = 0, high = limit;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        assign(excerpt(text, mid, options.truncation));
        if (bytes(state) <= 16384) low = mid; else high = mid - 1;
      }
      assign(excerpt(text, low, options.truncation));
    };
    fit(task, options.maxMessageChars, text => { state.task = text; state.taskTruncated = text.length < task.length; });
    const previous = messages.slice(0, current).filter(m => (m.role === "user" || (options.includeAssistant && m.role === "assistant")) && textOnly(m).trim());
    const selected = options.previousMessages && options.maxHistoryChars ? previous.slice(-options.previousMessages).reverse() : [];
    state.dialogueTruncated = previous.length > selected.length;
    let remaining = options.maxHistoryChars;
    for (const message of selected) {
      if (remaining <= 0) { state.dialogueTruncated = true; break; }
      const text = textOnly(message);
      const item: DialogueMessage = { role: message.role as DialogueMessage["role"], text: "", truncated: true };
      state.recentDialogue.unshift(item);
      if (bytes(state) > 16384) {
        if (options.truncation === "error") throw new RoutingError("INVALID_STATE", "Native routing state exceeds 16 KiB; shorten the request or change nativeRouting.context");
        state.recentDialogue.shift(); state.dialogueTruncated = true; break;
      }
      fit(text, Math.min(remaining, options.maxMessageChars), value => { item.text = value; item.truncated = value.length < text.length; });
      if (!item.text.trim()) { state.recentDialogue.shift(); state.dialogueTruncated = true; break; }
      remaining -= item.text.length;
      if (item.truncated) state.dialogueTruncated = true;
    }
  }
  return { state, summary: { taskChars: state.task.length, taskTruncated: state.taskTruncated,
    historyMessages: state.recentDialogue?.length ?? 0, historyChars: state.recentDialogue?.reduce((sum, m) => sum + m.text.length, 0) ?? 0,
    historyTruncated: state.dialogueTruncated ?? false, stateBytes: bytes(state) } };
}
