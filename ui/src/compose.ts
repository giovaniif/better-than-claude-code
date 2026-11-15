// Lets other panes add text to a session's reply box without lifting the
// composer's state: the composer listens for its own session id.

type Listener = (text: string) => void;

const listeners = new Map<string, Set<Listener>>();

export function onAppend(sessionId: string, listener: Listener): () => void {
  let set = listeners.get(sessionId);
  if (!set) listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(sessionId);
  };
}

export function appendToComposer(sessionId: string, text: string) {
  listeners.get(sessionId)?.forEach((listener) => listener(text));
}

export const SELECTION_CAP = 20_000;

/**
 * Part of an agent's answer, quoted for a reply: each line as a Markdown
 * quote, then a blank line where the reply goes. Cut to the cap.
 */
export function quoted(selection: string): string {
  const body = selection
    .slice(0, SELECTION_CAP)
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*\n|\s+$/g, "")
    .replace(/\n{3,}/g, "\n\n");
  if (!body.trim()) return "";
  return body
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n") + "\n\n";
}

/** A terminal selection as a fenced block, cut to the cap. */
export function fenced(selection: string): string {
  const body = selection.slice(0, SELECTION_CAP).replace(/\n+$/, "");
  return "```\n" + body + "\n```\n";
}
