import { describe, expect, test } from "bun:test";
import { MAX_INLINE_BYTES, userMessage, type Attachment } from "./message";

const png: Attachment = { id: "a1", name: "shot.png", mime: "image/png", size: 4, path: "/d/attachments/a1/shot.png" };
const notes: Attachment = { id: "a2", name: "notes.txt", mime: "text/plain", size: 2048, path: "/d/attachments/a2/notes.txt" };
const files: Record<string, Buffer> = { [png.path]: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
const read = (path: string) => {
  const bytes = files[path];
  if (!bytes) throw new Error(`ENOENT ${path}`);
  return bytes;
};

describe("userMessage", () => {
  test("plain text stays a plain string", () => {
    expect(userMessage("hi", [], read)).toEqual({
      type: "user",
      message: { role: "user", content: "hi" },
      parent_tool_use_id: null,
      session_id: "",
    });
  });

  test("an image goes inline as base64 and every file is named by path", () => {
    const msg = userMessage("look", [png, notes], read);
    expect(msg.message.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw==" } },
      {
        type: "text",
        text: "look\n\nAttached files:\n- /d/attachments/a1/shot.png (image/png, 4 B)\n- /d/attachments/a2/notes.txt (text/plain, 2 KB)",
      },
    ]);
  });

  test("attachments alone still make a text block", () => {
    const msg = userMessage("", [notes], read);
    expect(msg.message.content).toEqual([{ type: "text", text: "Attached files:\n- /d/attachments/a2/notes.txt (text/plain, 2 KB)" }]);
  });

  test("an image the API would refuse, or cannot read, is named by path only", () => {
    const big = { ...png, path: "/d/big.png", size: MAX_INLINE_BYTES + 1 };
    const gone = { ...png, path: "/d/gone.png" };
    const content = userMessage("x", [big, gone], read).message.content as any[];
    expect(content).toHaveLength(1);
    expect(content[0].text).toContain("- /d/big.png (image/png, 3.8 MB): too large to show inline");
    expect(content[0].text).toContain("- /d/gone.png (image/png, 4 B): could not be read");
  });

  test("other image types, such as SVG, are not sent inline", () => {
    const svg = { ...png, mime: "image/svg+xml", path: "/d/a.svg" };
    const content = userMessage("x", [svg], read).message.content as any[];
    expect(content.map((b) => b.type)).toEqual(["text"]);
  });
});
