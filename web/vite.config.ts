import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:4319" } },
});
