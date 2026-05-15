"use client";

import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

export function Topbar({ children }: { children?: React.ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const initial = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(initial);
    document.documentElement.classList.toggle("dark", initial);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <div className="flex items-center justify-between border-b border-line bg-[var(--surface)] px-6 py-3">
      <div className="flex-1">{children}</div>
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="Toggle theme"
        >
          {dark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
        <div className="w-8 h-8 rounded-full bg-[var(--bg)] border border-line flex items-center justify-center text-sm">
          E
        </div>
      </div>
    </div>
  );
}
