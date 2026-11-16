// Lets other panes add to a session's reply box without lifting the
// composer's state: the composer listens for its own session id.

/** Text goes into the box; quotes become cards above it. */
export interface Addition {
  text?: string;
  quotes?: string[];
}

type Listener = (added: Addition) => void;

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

function add(sessionId: string, added: Addition) {
  listeners.get(sessionId)?.forEach((listener) => listener(added));
}

/** Text for the box, as is (a terminal selection). */
export function appendToComposer(sessionId: string, text: string) {
  add(sessionId, { text });
}

/** Part of an agent's answer, as a quote card for a reply. */
export function quoteInComposer(sessionId: string, selection: string) {
  const quote = cleanQuote(selection);
  if (quote) add(sessionId, { quotes: [quote] });
}

/** A message yardd gave back (Edit, Stop): its leading quotes go back to
 *  cards, so editing a reply does not turn them into `>` text. */
export function returnToComposer(sessionId: string, message: string) {
  const { quotes, text } = splitQuotes(message);
  add(sessionId, quotes.length ? { quotes, text } : { text });
}

export const SELECTION_CAP = 20_000;

/** A selection as a quote: cut to the cap, outer blank lines and trailing
 *  space trimmed, runs of blank lines folded to one. Empty if nothing. */
export function cleanQuote(selection: string): string {
  const body = selection
    .slice(0, SELECTION_CAP)
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*\n|\s+$/g, "")
    .replace(/\n{3,}/g, "\n\n");
  return body.trim() ? body : "";
}

function blockquote(quote: string): string {
  return quote
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** What a reply sends: each quote as a Markdown blockquote, then the text,
 *  a blank line apart. Plain Markdown, so engines and older yardds read it
 *  as they always have. */
export function withQuotes(quotes: string[], text: string): string {
  return [...quotes.map(blockquote), ...(text ? [text] : [])].join("\n\n");
}

const QUOTE_LINE = /^>/;
const unquote = (line: string) => line.replace(/^> ?/, "");

/** The inverse of `withQuotes`: the blockquotes a message starts with, and
 *  the rest. A quote must end at a blank line; one that runs straight into
 *  text is left as text. */
export function splitQuotes(message: string): { quotes: string[]; text: string } {
  const lines = message.split("\n");
  const quotes: string[] = [];
  let i = 0;
  while (i < lines.length && QUOTE_LINE.test(lines[i])) {
    let j = i;
    while (j < lines.length && QUOTE_LINE.test(lines[j])) j++;
    if (j < lines.length && lines[j] !== "") break;
    const quote = lines.slice(i, j).map(unquote).join("\n");
    if (quote.trim()) quotes.push(quote);
    i = j + 1;
  }
  if (quotes.length === 0) return { quotes: [], text: message };
  return { quotes, text: lines.slice(i).join("\n") };
}

export interface QuoteSegment {
  quote: boolean;
  text: string;
}

/** A sent message in runs of quoted lines and plain text, for the bubble.
 *  Lines in a fenced block are never quotes. The blank line around a quote
 *  is spacing, not text. */
export function quoteSegments(message: string): QuoteSegment[] {
  const out: QuoteSegment[] = [];
  let fenced = false;
  let run: string[] = [];
  let quoting = false;
  const flush = () => {
    const text = quoting ? run.join("\n") : run.join("\n").replace(/^\n+|\n+$/g, "");
    if (quoting || text) out.push({ quote: quoting, text });
    run = [];
  };
  for (const line of message.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const quote = !fenced && QUOTE_LINE.test(line);
    if (quote !== quoting && run.length) flush();
    quoting = quote;
    run.push(quote ? unquote(line) : line);
  }
  if (run.length) flush();
  if (!out.some((s) => s.quote)) return [{ quote: false, text: message }];
  return out;
}

/** A terminal selection as a fenced block, cut to the cap. */
export function fenced(selection: string): string {
  const body = selection.slice(0, SELECTION_CAP).replace(/\n+$/, "");
  return "```\n" + body + "\n```\n";
}
