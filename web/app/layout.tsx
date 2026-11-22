import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";
import { Logo } from "@/components/Shape";
import { Nav } from "@/components/Nav";
import { ThemeToggle, themeScript } from "@/components/ThemeToggle";
import { SettingsProvider } from "@/components/SettingsProvider";
import { getData } from "@/lib/data";

const REPO = "https://github.com/Kanzaki7/fpl-optimizer";

export const metadata: Metadata = {
  title: { default: "FPL Optimizer — l'équipe optimale de Fantasy Premier League", template: "%s · FPL Optimizer" },
  description:
    "Pipeline Python et SQL qui collecte les données officielles de Fantasy Premier League, estime les points attendus de chaque joueur et choisit les 15 meilleurs sous budget par programmation linéaire.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { meta } = getData();
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand" aria-label="FPL Optimizer, accueil">
              <Logo />
              <span>FPL<span className="long"><small> / </small>OPTIMIZER</span></span>
            </Link>
            <Nav />
            <span className="spacer" />
            <a className="icon-btn hide-sm" href={REPO} aria-label="Code source sur GitHub" title="Code source">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path fill="currentColor" d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
              </svg>
            </a>
            <ThemeToggle />
          </div>
        </header>
        <main className="wrap">
          <SettingsProvider meta={meta}>{children}</SettingsProvider>
        </main>
        <footer className="foot">
          <div className="wrap">
            <span>
              Données : API publique de Fantasy Premier League. Projet personnel, sans lien avec la Premier League.
            </span>
            <span>
              <a href={REPO}>Code source</a> · Python, SQL, PuLP, Next.js
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
