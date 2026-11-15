// One JSON object per command, written in full before the process exits:
// a pipe that closes early must not leave an agent reading half an object.

import { writeSync } from "node:fs";

export interface Problem {
  /** Short machine code, e.g. `iso-not-running`, `needs-var`. */
  code: string;
  msg: string;
  /** What to run or change to fix it. */
  hint?: string;
}

export type Result = Record<string, unknown> & { ok: boolean; problems?: Problem[]; hint?: string };

/** A failure the command already explained: becomes `{ ok: false, problems }`, exit 1. */
export class Fail extends Error {
  constructor(
    public problems: Problem[],
    public extra: Record<string, unknown> = {},
  ) {
    super(problems.map((p) => p.msg).join("; "));
  }
}

/** Bad flags or arguments: exit 2. */
export class Usage extends Error {}

export const fail = (code: string, msg: string, hint?: string, extra: Record<string, unknown> = {}): never => {
  throw new Fail([{ code, msg, hint }], extra);
};

export function print(obj: Result, command: string): number {
  const body = { command, ...obj, problems: obj.problems ?? [] };
  const text = JSON.stringify(body, null, 2) + "\n";
  const buf = Buffer.from(text);
  let off = 0;
  // writeSync on a pipe can write part of the buffer; loop until all of it is out.
  while (off < buf.length) {
    try {
      off += writeSync(1, buf, off);
    } catch (e: any) {
      if (e?.code === "EAGAIN") continue;
      throw e;
    }
  }
  return obj.ok ? 0 : 1;
}
