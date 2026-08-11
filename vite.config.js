import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;

// Версия сборки из package.json — вшивается в бандл как __APP_VERSION__.
// По ней cacheBuster.js понимает, что установлена новая сборка, и чистит
// кеш WebView2 (см. src/utils/cacheBuster.js).
const pkgVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8")
).version;

export default defineConfig(async () => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  plugins: [
    react(),
    visualizer({
      filename: 'dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5183 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      input: {
        main: "index.html",
        float: "float.html",
      },
      external: ["@tauri-apps/plugin-dialog"],
      output: {
        // ★ Insight: Code splitting для уменьшения initial bundle size
        // vendor — React и другие библиотеки
        // charts — Recharts для дашборда
        // ui — Lucide иконки и TanStack Virtual
        manualChunks: (id) => {
          // Vendor libraries
          if (id.includes('node_modules')) {
            if (id.includes('react')) return 'vendor'
            if (id.includes('recharts')) return 'charts'
            if (id.includes('@tanstack')) return 'ui'
            if (id.includes('lucide')) return 'icons'
            return 'vendor'
          }
          // Large page components (separate from pages to avoid circular deps)
          if (id.includes('pages/Cards/') || id.includes('pages/Orders/') || id.includes('pages/Profiles/')) {
            return 'pages-components'
          }
        },
      },
    },
  },
}));
