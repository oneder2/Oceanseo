import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/manage/",
  publicDir: false,
  plugins: [react()],
  build: { outDir: "../dist-control-admin", emptyOutDir: true },
  server: {
    host: "127.0.0.1", port: 1442, strictPort: true,
    proxy: { "/v2": { target: process.env.OCEANSEO_ACCOUNTS_TARGET ?? "http://127.0.0.1:4791" } },
  },
});
