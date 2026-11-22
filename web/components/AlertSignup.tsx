"use client";
import Link from "next/link";
import { useState } from "react";

/** Inscription aux alertes e-mail pour l'équipe importée. */
export function AlertSignup({ entry }: { entry: number }) {
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | string>("idle");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    const r = await fetch("/api/alertes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, entry, website: trap }),
    }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) : {};
    setState(r?.ok ? "sent" : [body.error || "Inscription impossible pour le moment.", body.detail].filter(Boolean).join(" — "));
  };
  return (
    <section className="panel card signup">
      <h2>Recevoir ces conseils par e-mail</h2>
      {state === "sent" ? (
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          C&apos;est presque fini : ouvrez l&apos;e-mail envoyé à <b>{email}</b> et confirmez.
        </p>
      ) : (
        <form onSubmit={submit}>
          <p className="muted" style={{ margin: "0 0 10px", fontSize: 13.5 }}>
            La veille de chaque date limite, les transferts conseillés pour votre équipe. Désinscription en un clic.
          </p>
          <div className="pl-inline">
            <input className="field" type="email" required placeholder="vous@exemple.be" value={email}
              onChange={(e) => setEmail(e.target.value)} aria-label="Adresse e-mail" autoComplete="email" style={{ flex: 1, minWidth: 0 }} />
            <button className="btn" type="submit" disabled={state === "busy"}>{state === "busy" ? "…" : "M'inscrire"}</button>
          </div>
          <input className="sr" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
          {state !== "idle" && state !== "busy" ? <p className="hint" style={{ color: "var(--bad)", margin: "8px 0 0" }}>{state}</p> : null}
          <p className="hint" style={{ margin: "8px 0 0" }}>Adresse utilisée pour ces alertes uniquement. <Link href="/confidentialite">Confidentialité</Link></p>
        </form>
      )}
    </section>
  );
}
