import { NextResponse } from "next/server";
import { configured, findByEmail, insert, newToken, sendConfirmation, update } from "@/lib/alerts";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Inscription aux alertes : enregistre l'adresse (non confirmée) et envoie le lien de confirmation. */
export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: "Les alertes ne sont pas encore activées sur ce site." }, { status: 503 });
  let body: { email?: string; entry?: number; website?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Requête invalide." }, { status: 400 }); }
  if (body.website) return NextResponse.json({ ok: true });              // champ piège pour robots
  const email = String(body.email ?? "").trim().toLowerCase();
  const fplId = Number(body.entry);
  if (!EMAIL.test(email) || email.length > 254) return NextResponse.json({ error: "Adresse e-mail invalide." }, { status: 400 });
  if (!Number.isInteger(fplId) || fplId <= 0 || fplId > 999_999_999) return NextResponse.json({ error: "Identifiant FPL invalide." }, { status: 400 });

  try {
    const now = new Date().toISOString();
    const existing = await findByEmail(email);
    if (existing && Date.now() - new Date(existing.updated_at).getTime() < 2 * 60_000) {
      return NextResponse.json({ ok: true });                            // pas de rafale d'e-mails
    }
    const token = newToken();
    if (existing) await update(existing.id, { fpl_id: fplId, token, confirmed: false, updated_at: now });
    else await insert({ email, fpl_id: fplId, token, confirmed: false, updated_at: now });
    await sendConfirmation(email, token, fplId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Inscription impossible pour le moment. Réessayez plus tard." }, { status: 502 });
  }
}
