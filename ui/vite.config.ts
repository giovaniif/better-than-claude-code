import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// yardd serves ui/dist, so asset paths must be relative.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
