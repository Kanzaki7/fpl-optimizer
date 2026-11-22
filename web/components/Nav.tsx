"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Équipe" },
  { href: "/joueurs", label: "Joueurs" },
  { href: "/methode", label: "Méthode" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Navigation principale">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
