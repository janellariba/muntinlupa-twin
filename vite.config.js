// Vite build config: React (JSX) + Tailwind CSS v4 plugin.
// three.js is split into its own chunk so browsers can cache it separately from the app code.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], r3f: ["@react-three/fiber", "@react-three/drei"] },
      },
    },
  },
});
