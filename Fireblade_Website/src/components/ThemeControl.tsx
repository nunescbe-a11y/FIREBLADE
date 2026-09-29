"use client";
import { useEffect, useState } from "react";
import type { FirebladeTheme } from "@/lib/types";

function applyTheme(theme: FirebladeTheme) {
  const root = document.documentElement;
  root.dataset.firebladeTheme = theme.toLowerCase();
}

export default function ThemeControl({ initialTheme = "STANDARD" }: { initialTheme?: FirebladeTheme }) {
  const [theme, setTheme] = useState<FirebladeTheme>(initialTheme);
  const [busy, setBusy] = useState(false);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const change = async (next: FirebladeTheme) => {
    const before = theme; setTheme(next); applyTheme(next); setBusy(true);
    try {
      const r = await fetch("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: next }) });
      if (!r.ok) throw new Error("Theme could not be saved");
    } catch { setTheme(before); applyTheme(before); }
    finally { setBusy(false); }
  };
  return <label className="theme-control"><span>Appearance</span><select disabled={busy} value={theme} onChange={e => void change(e.target.value as FirebladeTheme)}><option value="STANDARD">Fireblade Standard</option><option value="NIGHTMARE">Fireblade Nightmare</option><option value="SYSTEM">Follow Device</option></select></label>;
}
