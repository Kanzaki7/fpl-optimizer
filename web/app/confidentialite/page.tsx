import type { Metadata } from "next";

export const metadata: Metadata = { title: "Confidentialité" };

export default function Confidentialite() {
  return (
    <div className="doc" style={{ maxWidth: 760, margin: "36px 0 64px", gap: 28 }}>
      <section>
        <h1>Confidentialité</h1>
        <p className="lead muted" style={{ marginTop: 12 }}>
          Le site fonctionne sans compte et sans cookie de suivi. Seules les alertes e-mail, si vous les demandez,
          enregistrent des données personnelles.
        </p>
      </section>
      <section>
        <h2>Ce qui est enregistré</h2>
        <ul>
          <li><strong>Pour les alertes :</strong> votre adresse e-mail, l&apos;identifiant de votre équipe FPL, la date d&apos;inscription et la dernière journée envoyée.</li>
          <li><strong>Dans votre navigateur seulement :</strong> vos réglages, votre identifiant FPL et vos transferts en cours. Rien n&apos;est envoyé au serveur.</li>
          <li>L&apos;équipe FPL est lue sur l&apos;API publique de Fantasy Premier League, sans mot de passe. Le site ne peut rien modifier sur votre compte.</li>
        </ul>
      </section>
      <section>
        <h2>Pourquoi et combien de temps</h2>
        <ul>
          <li>Uniquement pour vous envoyer, la veille de chaque date limite, les transferts conseillés pour votre équipe (base légale : votre consentement).</li>
          <li>Une inscription non confirmée est effacée au bout de 7 jours. Une désinscription efface immédiatement l&apos;adresse et l&apos;identifiant.</li>
          <li>Aucune donnée n&apos;est vendue, partagée ni utilisée pour de la publicité.</li>
        </ul>
      </section>
      <section>
        <h2>Prestataires</h2>
        <ul>
          <li><strong>Supabase</strong> (base de données, hébergée dans l&apos;Union européenne) : stockage des abonnements.</li>
          <li><strong>Google (Gmail)</strong> : envoi des e-mails.</li>
          <li><strong>Vercel</strong> (site) et <strong>GitHub Actions</strong> (calcul quotidien) : traitement technique.</li>
        </ul>
      </section>
      <section>
        <h2>Vos droits</h2>
        <p>
          Chaque e-mail contient un lien de désinscription. Pour toute autre demande (accès, rectification, effacement),
          écrivez à l&apos;adresse qui vous envoie les alertes. Vous pouvez aussi saisir l&apos;Autorité de protection des
          données (Belgique).
        </p>
      </section>
    </div>
  );
}
