export type RemovalDecision = { id: string; entityId: string; action: string; createdAt: Date };

// Deletion stays intentional; an ignored import is intentional only until the
// user explicitly reverses that choice. Keep both decisions in the audit log.
export function activeExplicitRemovalIds(decisions: RemovalDecision[]) {
  const deleted = new Set<string>();
  const latestIgnore = new Map<string, boolean>();
  for (const decision of [...decisions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))) {
    if (decision.action === "delete") deleted.add(decision.entityId);
    else if ((decision.action === "suppress_historical" || decision.action === "undo_suppress_historical") && !latestIgnore.has(decision.entityId)) latestIgnore.set(decision.entityId, decision.action === "suppress_historical");
  }
  return new Set([...deleted, ...[...latestIgnore].filter(([, active]) => active).map(([id]) => id)]);
}
