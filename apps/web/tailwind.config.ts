import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Bind Tailwind utilities like `bg-bg`, `text-ink`, `border-line`
        // straight to the CSS custom properties so light/dark just works.
        bg:           "var(--bg)",
        surface:      "var(--surface)",
        "surface-2":  "var(--surface-2)",
        "surface-3":  "var(--surface-3)",
        ink:          "var(--ink)",
        "ink-2":      "var(--ink-2)",
        muted:        "var(--muted)",
        line:         "var(--line)",
        "line-strong": "var(--line-strong)",
        accent:       "var(--accent)",
        "accent-fg":  "var(--accent-fg)",
        "accent-soft": "var(--accent-soft)",
        ok:           "var(--ok)",
        warn:         "var(--warn)",
        bad:          "var(--bad)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "10px",
        lg: "14px",
        xl: "18px",
      },
      letterSpacing: {
        tightest: "-0.025em",
      },
    },
  },
  plugins: [],
};
export default config;
