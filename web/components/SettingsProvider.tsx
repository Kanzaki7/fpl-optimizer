"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Meta } from "@/lib/types";
import { defaults, sameSettings, type Settings } from "@/lib/plan";

interface Ctx {
  settings: Settings;
  base: Settings;
  isDefault: boolean;
  /** aucun réglage modifié à part le mode et l'équipe importée */
  isClean: boolean;
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
      if (!saved) return;
      const { gw0, ...s } = saved;
      // une période d'une journée passée ne vaut plus rien ; l'équipe importée, si
      setSettings(gw0 === meta.gws[0] ? { ...base, ...s }
        : { ...base, mode: s.mode ?? "optimal", entry: s.entry ?? null, maxT: s.maxT ?? base.maxT });
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
    isClean: sameSettings({ ...settings, mode: base.mode, entry: base.entry }, base),
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
    // garde l'équipe importée et le mode, remet le reste à zéro
    reset: () => save({ ...base, mode: settings.mode, entry: settings.entry }),
  }), [settings, base, save]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("useSettings hors de SettingsProvider");
  return c;
}
