"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

const TEXT = {
  confirmer: {
    title: "Confirmer vos alertes",
    body: "La veille de chaque date limite, vous recevrez par e-mail les transferts conseillés pour votre équipe.",
    button: "Confirmer",
    done: "C'est confirmé : premier e-mail la veille de la prochaine date limite.",
  },
  desinscrire: {
    title: "Se désinscrire",
    body: "Votre adresse et votre identifiant FPL seront effacés de la base. Vous ne recevrez plus d'e-mails.",
    button: "Me désinscrire",
    done: "C'est fait : votre adresse a été effacée.",
  },
} as const;

/** Confirmation ou désinscription : un bouton, pour qu'un antivirus de messagerie qui ouvre les liens ne le fasse pas à votre place. */
export function AlertAction({ kind }: { kind: keyof typeof TEXT }) {
  const t = useSearchParams().get("t") ?? "";
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  const x = TEXT[kind];
  const run = async () => {
    setState("busy");
    const r = await fetch(`/api/alertes/${kind}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t }),
    }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) : {};
    setState(r?.ok ? "done" : body.error || "Une erreur est survenue. Réessayez plus tard.");
  };
  return (
    <section className="panel empty-state" style={{ marginTop: 36 }}>
      <h2>{x.title}</h2>
      {state === "done" ? <p>{x.done}</p> : (
        <>
          <p>{x.body}</p>
          {!t ? <p style={{ color: "var(--bad)" }}>Lien incomplet : ouvrez-le depuis l&apos;e-mail reçu.</p> : (
            <button type="button" className="btn" onClick={run} disabled={state === "busy"} style={{ marginTop: 8 }}>
              {state === "busy" ? "…" : x.button}
            </button>
          )}
          {state !== "idle" && state !== "busy" ? <p style={{ color: "var(--bad)", marginTop: 12 }}>{state}</p> : null}
        </>
      )}
      <p className="hint" style={{ marginTop: 16 }}><Link href="/">Retour à l&apos;équipe</Link> · <Link href="/confidentialite">Confidentialité</Link></p>
    </section>
  );
}
