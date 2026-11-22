import { NextResponse } from "next/server";
import { configured, remove } from "@/lib/alerts";

/**
 * Désinscription : depuis la page du site (JSON { t }) ou en un clic depuis
 * la messagerie (en-tête List-Unsubscribe, jeton dans l'adresse). L'adresse
 * est effacée de la base, pas seulement désactivée.
 */
export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: "Alertes non activées." }, { status: 503 });
  const url = new URL(req.url);
  let t = url.searchParams.get("t") ?? "";
  if (!t && req.headers.get("content-type")?.includes("application/json")) {
    t = String((await req.json().catch(() => ({}))).t ?? "");
  }
  if (!/^[a-f0-9]{48}$/.test(t)) return NextResponse.json({ error: "Lien invalide." }, { status: 400 });
  await remove(t);
  return NextResponse.json({ ok: true });
}
