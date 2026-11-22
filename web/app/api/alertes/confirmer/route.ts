import { NextResponse } from "next/server";
import { confirm, configured } from "@/lib/alerts";

export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: "Alertes non activées." }, { status: 503 });
  const { t } = await req.json().catch(() => ({ t: "" }));
  if (!/^[a-f0-9]{48}$/.test(String(t))) return NextResponse.json({ error: "Lien invalide." }, { status: 400 });
  const rows = await confirm(t);
  return rows.length ? NextResponse.json({ ok: true, fpl_id: rows[0].fpl_id })
    : NextResponse.json({ error: "Lien expiré ou déjà utilisé." }, { status: 404 });
}
