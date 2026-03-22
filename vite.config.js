import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_ORIGIN || "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
  preview: { host: true, port: 4173 },
  optimizeDeps: {
    include: ["@tensorflow/tfjs", "@tensorflow-models/coco-ssd"],
  },
});
