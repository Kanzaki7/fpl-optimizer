import "server-only";
import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

/**
 * Abonnements aux alertes e-mail : table Supabase « subscribers » (accès par
 * la clé secrète, jamais exposée au navigateur) et envoi par Gmail.
 */
const SITE = (process.env.SITE_URL ?? "https://fpl-optimizer-beta.vercel.app").replace(/\/$/, "");

export interface Subscriber {
  id: string; email: string; fpl_id: number; token: string; confirmed: boolean; updated_at: string;
}

export const configured = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

async function rest(method: string, query: string, body?: object): Promise<Subscriber[]> {
  const key = process.env.SUPABASE_SECRET_KEY!;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json", Prefer: "return=representation" };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;   // ancienne clé service_role
  const res = await fetch(`${process.env.SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/subscribers?${query}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} : ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
}

export const newToken = () => randomBytes(24).toString("hex");
export const findByEmail = async (email: string) => (await rest("GET", `email=eq.${encodeURIComponent(email)}&select=*`))[0];
export const insert = (row: Partial<Subscriber>) => rest("POST", "select=*", row);
export const update = (id: string, patch: Partial<Subscriber>) => rest("PATCH", `id=eq.${id}&select=*`, patch);
export const confirm = (token: string) =>
  rest("PATCH", `token=eq.${encodeURIComponent(token)}&select=*`, { confirmed: true, confirmed_at: new Date().toISOString() } as object);
export const remove = (token: string) => rest("DELETE", `token=eq.${encodeURIComponent(token)}&select=*`);

export async function sendConfirmation(to: string, token: string, fplId: number) {
  const link = `${SITE}/alertes/confirmer?t=${token}`;
  const mono = "'IBM Plex Mono',Menlo,Consolas,monospace";
  const sans = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f6f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #dfe1e4;border-top:3px solid #ff4a17">
<tr><td style="padding:18px 24px;border-bottom:1px solid #dfe1e4;font:600 13px ${mono};letter-spacing:.08em;color:#0e1013">FPL <span style="color:#8a909b">/</span> OPTIMIZER</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 10px;font:500 20px/1.3 ${mono};text-transform:uppercase;color:#0e1013">Confirmez vos alertes</h1>
<p style="margin:0 0 18px;font:15px/1.55 ${sans};color:#5c6270">La veille de chaque date limite, vous recevrez les transferts conseillés pour l'équipe FPL n° ${fplId}. Confirmez que c'est bien vous :</p>
<a href="${link}" style="display:inline-block;padding:12px 18px;background:#0e1013;color:#fff;font:500 12px ${mono};letter-spacing:.08em;text-transform:uppercase;text-decoration:none">Confirmer</a>
<p style="margin:18px 0 0;font:12.5px/1.55 ${sans};color:#8a909b">Vous n'avez rien demandé ? Ignorez cet e-mail : sans confirmation, votre adresse est effacée sous 7 jours.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Confirmez vos alertes FPL Optimizer pour l'équipe n° ${fplId} :\n${link}\n\nVous n'avez rien demandé ? Ignorez cet e-mail : sans confirmation, votre adresse est effacée sous 7 jours.`;
  // Gmail par défaut ; SMTP_HOST / SMTP_PORT permettent un autre serveur (ou un serveur de test)
  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com", port, secure: port === 465,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  await transport.sendMail({
    from: { name: "FPL Optimizer", address: process.env.GMAIL_USER! },
    to, subject: "Confirmez vos alertes FPL Optimizer", html, text,
  });
}
