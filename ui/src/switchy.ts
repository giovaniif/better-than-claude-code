/** The host scope Switchy asks with: what the user picked on this page, else
 * the scope the conversation last used, else every host. A scope naming a
 * host that has since been removed falls back to every host: the picker has
 * no option for it (so it reads "All hosts") and yardd would refuse it. */
export function switchyScope(
  chosen: string | null,
  saved: string | undefined,
  hosts: string[],
): string {
  const scope = chosen ?? saved ?? "all";
  return scope === "all" || hosts.includes(scope) ? scope : "all";
}
