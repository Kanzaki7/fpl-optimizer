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

  // Deux étapes distinctes, pour savoir laquelle échoue (message sans aucune clé)
  const now = new Date().toISOString();
  const token = newToken();
  try {
    const existing = await findByEmail(email);
    if (existing?.confirmed && existing.fpl_id === fplId) {
      return NextResponse.json({ ok: true, status: "already" });          // rien à faire, aucun e-mail
    }
    if (existing && Date.now() - new Date(existing.updated_at).getTime() < 2 * 60_000) {
      return NextResponse.json({ ok: true, status: "recent" });           // pas de rafale d'e-mails
    }
    if (existing) await update(existing.id, { fpl_id: fplId, token, confirmed: false, updated_at: now });
    else await insert({ email, fpl_id: fplId, token, confirmed: false, updated_at: now });
  } catch (e) {
    console.error("alertes : base de données", e);
    return NextResponse.json({ error: "Inscription impossible pour le moment.", detail: `Base de données : ${short(e)}` }, { status: 502 });
  }
  try {
    await sendConfirmation(email, token, fplId);
  } catch (e) {
    console.error("alertes : envoi", e);
    return NextResponse.json({ error: "L'e-mail de confirmation n'a pas pu partir.", detail: `Envoi : ${short(e)}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status: "sent" });
}

/** Message d'erreur court et sans secret : code et première ligne. */
function short(e: unknown) {
  const err = e as { code?: string; responseCode?: number; message?: string };
  const msg = String(err?.message ?? e).split("\n")[0].replace(/(sb_secret_|eyJ)[\w.-]+/g, "[clé]").slice(0, 180);
  return [err?.code, err?.responseCode, msg].filter(Boolean).join(" · ");
}
