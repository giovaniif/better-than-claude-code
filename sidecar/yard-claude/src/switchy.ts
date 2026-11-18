/** Switchy defaults to evidence-only, but explicit access uses the normal SDK policy. */
export function readOnlySwitchy(start: {switchy?: boolean; permission?: string}): boolean {
  return !!start.switchy && (start.permission ?? "plan") === "plan";
}
export function switchyProfile(start: {switchy?: boolean; permission?: string}): Record<string, unknown> {
  if (!start.switchy) return {};
  if (!readOnlySwitchy(start)) return {persistSession: false};
  return {
    tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [],
    plugins: [], hooks: {}, persistSession: false, maxTurns: 1,
    systemPrompt: "You are Switchy. Answer from the supplied evidence and cite its source IDs.",
    allowDangerouslySkipPermissions: false,
  };
}
