/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        "bg-base":        "#0f1117",
        "bg-card":        "#1a1d27",
        "bg-hover":       "#21253a",
        "accent-green":   "#22c55e",
        "accent-red":     "#ef4444",
        "accent-yellow":  "#eab308",
        "accent-blue":    "#3b82f6",
        "accent-purple":  "#a855f7",
        "text-primary":   "#e2e8f0",
        "text-secondary": "#94a3b8",
        "border-default": "#2d3148",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};
