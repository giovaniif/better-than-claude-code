/** The host scope Switchy asks with: what the user picked on this page, else
 * the scope the conversation last used, else every host. */
export function switchyScope(
  chosen: string | null,
  saved: string | undefined,
  _hosts: string[],
): string {
  return chosen ?? saved ?? "all";
}
