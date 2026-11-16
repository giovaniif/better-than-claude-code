// Accounts: more than one login per engine on a host (see docs/ARCHITECTURE.md,
// Accounts). Default is every engine's own login and is never listed by yardd.
import type { AccountEntry, Engine, Models, Usage } from "./protocol";
import { ENGINES } from "./engines";

export const DEFAULT_ACCOUNT = "default";

export interface AccountChoice {
  id: string;
  name: string;
}

/** The account a session runs under; sessions from an older yardd have none. */
export const accountOf = (s: { account?: string } | undefined): string => s?.account || DEFAULT_ACCOUNT;

/** Default first, then the engine's own added accounts. */
export function accountChoices(list: AccountEntry[] | undefined, engine: Engine): AccountChoice[] {
  return [
    { id: DEFAULT_ACCOUNT, name: "Default" },
    ...(list ?? []).filter((a) => a.engine === engine).map((a) => ({ id: a.id, name: a.name })),
  ];
}

/** A removed account's id stands in for its name. */
export function accountName(list: AccountEntry[] | undefined, engine: Engine, id: string): string {
  return accountChoices(list, engine).find((a) => a.id === id)?.name ?? id;
}

/** What a session says about its account, or null where there is nothing to
 *  tell apart: an engine with only Default and a session on it. */
export function accountLabel(list: AccountEntry[] | undefined, s: { engine: Engine; account?: string }): string | null {
  const id = accountOf(s);
  if (id === DEFAULT_ACCOUNT && accountChoices(list, s.engine).length < 2) return null;
  return accountName(list, s.engine, id);
}

/** One engine's limits as the given account reports them, in the shape the meters read. */
export function usageForAccount(usage: Usage, engine: Engine, account: string): Usage {
  if (account === DEFAULT_ACCOUNT) return usage;
  return { [engine]: usage.accounts?.[account] } as Usage;
}

/** The usage of each engine under the account picked for it. */
export function usageForPicks(usage: Usage, picks: Partial<Record<Engine, string>>): Usage {
  const out: Usage = { ...usage };
  for (const engine of ENGINES) {
    const account = picks[engine] ?? DEFAULT_ACCOUNT;
    if (account !== DEFAULT_ACCOUNT) (out as any)[engine] = usage.accounts?.[account];
  }
  return out;
}

/** Where a pick of an account under another engine moves the choice: that
 *  engine's default model, keeping the effort where the model has it. An
 *  account only runs on its own engine, so leaving the choice on the old one
 *  would start the session on the old engine's Default instead. Null when the
 *  engine has no models to move to. */
export function choiceOnEngine(models: Models, engine: Engine, effort: string): { engine: Engine; model: string; effort: string } | null {
  const list = models[engine] ?? [];
  const model = list.find((m) => m.isDefault) ?? list[0];
  if (!model) return null;
  const kept = model.efforts.includes(effort) ? effort : (model.defaultEffort ?? model.efforts[0] ?? effort);
  return { engine, model: model.id, effort: kept };
}
