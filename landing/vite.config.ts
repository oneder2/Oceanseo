import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: { outDir: "../dist-landing", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 1441,
    strictPort: true,
    proxy: {
      "/health": {
        target: "https://oceanseo.gellaronline.cc",
        changeOrigin: true,
      },
    },
  },
});
