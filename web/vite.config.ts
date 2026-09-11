import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    // En desarrollo el frontend habla con la API local; en produccion
    // los dos los sirve el mismo contenedor.
    proxy: { "/api": "http://localhost:3000" },
  },
});
