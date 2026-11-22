import { NextResponse } from "next/server";
import { freeTransfers, type Entry } from "@/lib/entry";

const BASE = process.env.FPL_API_BASE ?? "https://fantasy.premierleague.com/api";

class FplError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}/`, {
      headers: { "User-Agent": "fpl-optimizer (+https://github.com/Kanzaki7/fpl-optimizer)", Accept: "application/json" },
      next: { revalidate: 120 },
    });
  } catch {
    throw new FplError(502, "L'API FPL ne répond pas. Réessayez dans quelques minutes.");
  }
  if (res.status === 404) throw new FplError(404, "Aucune équipe FPL avec cet identifiant.");
  if (!res.ok) throw new FplError(502, `L'API FPL a refusé la demande (${res.status}). Réessayez plus tard.`);
  return res.json() as Promise<T>;
}

interface EntryApi {
  id: number; name: string; player_first_name: string; player_last_name: string;
  current_event: number | null; summary_overall_rank: number | null; summary_overall_points: number | null;
}
interface PicksApi { active_chip: string | null; picks: { element: number }[]; entry_history: { bank: number } }
interface HistoryApi { current: { event: number; event_transfers: number }[]; chips: { name: string; event: number }[] }

/** Lecture seule : l'équipe publique d'un joueur FPL, sans identifiants. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) {
    return NextResponse.json({ error: "L'identifiant FPL est un nombre, par exemple 1234567." }, { status: 400 });
  }
  try {
    const [entry, history] = await Promise.all([
      get<EntryApi>(`entry/${id}`),
      get<HistoryApi>(`entry/${id}/history`),
    ]);
    if (!entry.current_event) throw new FplError(404, "Cette équipe n'a encore joué aucune journée.");
    let event = entry.current_event;
    let picks = await get<PicksApi>(`entry/${id}/event/${event}/picks`);
    // un Free Hit ne dure qu'une journée : l'équipe d'avant revient ensuite
    const freehit = picks.active_chip === "freehit";
    if (freehit && event > 1) {
      event -= 1;
      picks = await get<PicksApi>(`entry/${id}/event/${event}/picks`);
    }
    const body: Entry = {
      id: entry.id,
      name: entry.name,
      manager: `${entry.player_first_name} ${entry.player_last_name}`.trim(),
      event,
      picks: picks.picks.map((p) => p.element),
      bank: picks.entry_history.bank / 10,
      ft: freeTransfers(history.current, history.chips),
      overall_rank: entry.summary_overall_rank,
      points: entry.summary_overall_points,
      freehit,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } });
  } catch (e) {
    const err = e instanceof FplError ? e : new FplError(500, "Import impossible pour le moment.");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
