import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          ink: "var(--pc-ink)",
          raised: "var(--pc-ink-raised)",
          blue: "var(--pc-blue)",
          cyan: "var(--pc-cyan)",
          coral: "var(--pc-coral)",
          paper: "var(--pc-paper)",
          "paper-bright": "var(--pc-paper-bright)",
          chrome: "var(--pc-chrome)",
          muted: "var(--pc-muted)",
          line: "var(--pc-line)",
          success: "var(--pc-success)",
          warning: "var(--pc-warning)",
          danger: "var(--pc-danger)",
        },
      },
      fontFamily: {
        sans: ["var(--font-pc-body)", "system-ui", "sans-serif"],
        display: ["var(--font-pc-display)", "Impact", "sans-serif"],
        mono: ["var(--font-pc-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
