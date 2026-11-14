// Builds the SDK user message for one prompt. Kept apart from main.ts so it
// can be tested without starting the SDK.
import { readFileSync } from "node:fs";

/** An attachment as yardd sends it: saved on this host by `attach.put`. */
export interface Attachment {
  id?: string;
  name: string;
  mime: string;
  size: number;
  path: string;
}

/** Image types the Messages API takes as base64 blocks. */
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** The API refuses an image over 5 MB of base64, which is 3.75 MB of bytes. */
export const MAX_INLINE_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4);

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Same wording as yardd's `attachments::prompt_text`, which Codex gets. */
export function promptText(text: string, attachments: Attachment[], notes: Map<string, string> = new Map()): string {
  if (!attachments.length) return text;
  const lines = attachments.map((a) => {
    const note = notes.get(a.path);
    return `- ${a.path} (${a.mime}, ${humanSize(a.size)})${note ? `: ${note}` : ""}`;
  });
  const head = text.trimEnd();
  return `${head ? head + "\n\n" : ""}Attached files:\n${lines.join("\n")}`;
}

/** The `user` message for the SDK's streaming input. Every attachment is
 *  named by path in the text; images also go inline, ahead of the text as
 *  the API recommends. */
export function userMessage(
  text: string,
  attachments: Attachment[] = [],
  read: (path: string) => Buffer = (p) => readFileSync(p),
) {
  const wrap = (content: unknown) => ({
    type: "user" as const,
    message: { role: "user" as const, content },
    parent_tool_use_id: null,
    session_id: "",
  });
  if (!attachments.length) return wrap(text);

  const images: unknown[] = [];
  const notes = new Map<string, string>();
  for (const a of attachments) {
    if (!INLINE.has(a.mime)) continue;
    if (a.size > MAX_INLINE_BYTES) {
      notes.set(a.path, "too large to show inline");
      continue;
    }
    try {
      const data = read(a.path).toString("base64");
      images.push({ type: "image", source: { type: "base64", media_type: a.mime, data } });
    } catch {
      notes.set(a.path, "could not be read");
    }
  }
  return wrap([...images, { type: "text", text: promptText(text, attachments, notes) }]);
}
