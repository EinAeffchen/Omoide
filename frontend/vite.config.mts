/// <reference types="vite/client" />
/// <reference types="vite/types/importMeta.d.ts" />

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode, command }) => {
  const domain = process.env.DOMAIN || "http://localhost:8123/";

  // ---- START DEBUG LOG ----
  console.log(`[vite.config.js] Mode: ${mode}`);
  console.log(`[vite.config.js] Domain is set to: ${domain}`);
  // ---- END DEBUG LOG ----
  let base: string = "/";
  if (mode == "production") {
    base = "/static/";
  }

  return {
    base: base,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `${domain}`,
        },
      },
    },
    build: {
      minify: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
