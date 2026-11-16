// The engines Switchyard drives, in one place (yardd's twin is crates/yardd/src/engines.rs).
import type { Engine, Models } from "./protocol";

/** Every engine, in the order pickers and the Hosts page list them. */
export const ENGINES: Engine[] = ["claude", "codex", "opencode", "grok"];

/** Short names: "Hand off to Codex". */
export const ENGINE_NAME: Record<Engine, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode", grok: "Grok" };

/** Product names, for logins and the Hosts page. */
export const ENGINE_LABEL: Record<Engine, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", grok: "Grok" };

/** How to install each CLI on a host. */
export const ENGINE_INSTALL: Record<Engine, string> = {
  claude: "npm i -g @anthropic-ai/claude-code",
  codex: "npm i -g @openai/codex",
  opencode: "npm i -g opencode-ai",
  grok: "npm i -g @xai-official/grok",
};

/** How to log each CLI in from a terminal, for a host the app cannot reach yet. */
export const ENGINE_LOGIN: Record<Engine, string> = {
  claude: "claude setup-token",
  codex: "codex login --device-auth",
  opencode: "opencode auth login",
  grok: "grok login --device-auth",
};

/** Where a device-code login signs in, for "sign in with your … account". */
export const ENGINE_ACCOUNT: Partial<Record<Engine, string>> = { codex: "ChatGPT", grok: "Grok (x.ai)", claude: "Claude" };

/** OpenCode runs on providers, each logged in on its own: its Log in adds one. */
export const addsProviders = (engine: Engine) => engine === "opencode";

/** Claude and Codex are always offered, as before there were more; any other
 *  engine only once its host reports models for it (it is installed there). */
const ALWAYS: Engine[] = ["claude", "codex"];

/** The engines a model picker lists on a host, `first` leading. */
export function pickerEngines(models: Models, first?: Engine): Engine[] {
  const listed = ENGINES.filter((e) => ALWAYS.includes(e) || (models[e]?.length ?? 0) > 0);
  return first ? [first, ...listed.filter((e) => e !== first)] : listed;
}

/** Which engine reviews work done on `engine`: Claude and Codex review each
 *  other, any other engine gets Claude, else the first one with models. */
export function reviewEngine(engine: Engine, models: Models): Engine | null {
  const preferred: Engine = engine === "claude" ? "codex" : "claude";
  if (preferred !== engine && (models[preferred]?.length ?? 0) > 0) return preferred;
  return ENGINES.find((e) => e !== engine && (models[e]?.length ?? 0) > 0) ?? null;
}
