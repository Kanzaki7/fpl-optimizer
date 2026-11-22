/** Équipe importée depuis l'API publique FPL (lecture seule, sans connexion). */
export interface Entry {
  id: number;
  name: string;
  manager: string;
  /** journée dont viennent les joueurs (la dernière dont la date limite est passée) */
  event: number;
  picks: number[];
  /** banque en millions */
  bank: number;
  /** transferts gratuits estimés pour la prochaine journée */
  ft: number;
  overall_rank: number | null;
  points: number | null;
  freehit: boolean;
}

interface HistoryRow { event: number; event_transfers: number }
interface Chip { name: string; event: number }

/**
 * Transferts gratuits disponibles avant la prochaine journée, d'après
 * l'historique public : 1 par journée après la première, report jusqu'à 5,
 * et le joker ou le Free Hit ne consomment rien.
 */
export function freeTransfers(history: HistoryRow[], chips: Chip[]): number {
  const chipAt = new Map(chips.map((c) => [c.event, c.name]));
  let ft: number | null = null;
  for (const h of [...history].sort((a, b) => a.event - b.event)) {
    if (ft === null) { ft = 1; continue; }
    const chip = chipAt.get(h.event);
    ft = chip === "wildcard" || chip === "freehit"
      ? Math.min(5, ft + 1)
      : Math.min(5, Math.max(0, ft - h.event_transfers) + 1);
  }
  return ft ?? 1;
}
