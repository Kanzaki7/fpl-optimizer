"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Meta } from "@/lib/types";
import { defaults, sameSettings, type Settings } from "@/lib/plan";

interface Ctx {
  settings: Settings;
  base: Settings;
  isDefault: boolean;
  update: (patch: Partial<Settings>) => void;
  toggle: (kind: "force" | "exclude", id: number) => void;
  reset: () => void;
}

const SettingsContext = createContext<Ctx | null>(null);
const KEY = "fpl-reglages";

/** Réglages de l'utilisateur, partagés entre les pages et gardés dans le navigateur. */
export function SettingsProvider({ meta, children }: { meta: Meta; children: React.ReactNode }) {
  const base = useMemo(() => defaults(meta), [meta]);
  const [settings, setSettings] = useState<Settings>(base);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      // des réglages d'une journée passée ne valent plus rien
      if (saved && saved.gw0 === meta.gws[0]) {
        const { gw0: _, ...s } = saved;
        void _;
        setSettings({ ...base, ...s });
      }
    } catch {}
  }, [base, meta.gws]);

  const save = useCallback((s: Settings) => {
    setSettings(s);
    try { localStorage.setItem(KEY, JSON.stringify({ ...s, gw0: meta.gws[0] })); } catch {}
  }, [meta.gws]);

  const value = useMemo<Ctx>(() => ({
    settings,
    base,
    isDefault: sameSettings(settings, base),
    update: (patch) => {
      const s = { ...settings, ...patch };
      if (s.to < s.from) s.to = s.from;
      save(s);
    },
    toggle: (kind, id) => {
      const other = kind === "force" ? "exclude" : "force";
      const has = settings[kind].includes(id);
      save({
        ...settings,
        [kind]: has ? settings[kind].filter((x) => x !== id) : [...settings[kind], id],
        [other]: settings[other].filter((x) => x !== id),
      });
    },
    reset: () => save(base),
  }), [settings, base, save]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("useSettings hors de SettingsProvider");
  return c;
}
