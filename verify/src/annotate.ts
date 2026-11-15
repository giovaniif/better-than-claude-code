// `annotate`: before/after crops with a highlight box and captions, for PR
// bodies. Rendered as HTML in Chromium, so no image library is needed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { pngSize } from "./browser";
import { type Args, ensureDir, need, STATE, str } from "./common";
import { Usage, type Result } from "./out";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function annotate(a: Args): Promise<Result> {
  const before = need(a, "before");
  const after = need(a, "after");
  // Box in CSS pixels of the page (the screenshots are 2x).
  const dpr = Number(str(a, "dpr", "2"));
  const boxText = str(a, "box");
  const box = boxText ? boxText.split(",").map(Number) : null;
  if (box && (box.length !== 4 || box.some((n) => !Number.isFinite(n)))) throw new Usage("--box x,y,w,h in CSS pixels");
  const pad = Number(str(a, "pad", "48"));
  const caption = str(a, "caption", "");
  const labels = [str(a, "before-label", "Before")!, str(a, "after-label", "After")!];
  const out = str(a, "out") ?? join(ensureDir(join(STATE, "annotate")), `annotated-${Date.now()}.png`);

  const panel = (file: string, label: string) => {
    const { width, height } = pngSize(file);
    const W = width / dpr;
    const H = height / dpr;
    const [x, y, w, h] = box ?? [0, 0, W, H];
    const cx = Math.max(0, x - pad);
    const cy = Math.max(0, y - pad);
    const cw = Math.min(W - cx, w + 2 * pad);
    const ch = Math.min(H - cy, h + 2 * pad);
    const data = readFileSync(file).toString("base64");
    return `<figure><figcaption>${esc(label)}</figcaption>
      <div class="crop" style="width:${cw}px;height:${ch}px">
        <img src="data:image/png;base64,${data}" style="width:${W}px;height:${H}px;left:${-cx}px;top:${-cy}px">
        ${box ? `<div class="hl" style="left:${x - cx}px;top:${y - cy}px;width:${w}px;height:${h}px"></div>` : ""}
      </div></figure>`;
  };
  const html = `<!doctype html><html><head><style>
    body { margin: 0; font: 14px/1.4 Inter, system-ui, sans-serif; color: #1a1a1a; background: #fff; }
    #sheet { display: inline-block; padding: 16px; }
    .row { display: flex; gap: 16px; align-items: flex-start; }
    figure { margin: 0; }
    figcaption { font-weight: 600; margin-bottom: 6px; }
    .crop { position: relative; overflow: hidden; border: 1px solid #dcdcdc; border-radius: 6px; }
    .crop img { position: absolute; max-width: none; }
    .hl { position: absolute; border: 3px solid #e5484d; border-radius: 4px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.12); }
    .cap { margin-top: 10px; max-width: 900px; color: #444; }
  </style></head><body><div id="sheet"><div class="row">${panel(before, labels[0])}${panel(after, labels[1])}</div>${caption ? `<div class="cap">${esc(caption)}</div>` : ""}</div></body></html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: dpr, viewport: { width: 3000, height: 2000 } });
    await page.setContent(html);
    await page.locator("#sheet").screenshot({ path: out });
  } finally {
    await browser.close();
  }
  return { ok: true, out, size: pngSize(out) };
}
