import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/static/controller-app/",
  build: {
    outDir: "../static/controller-app",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

