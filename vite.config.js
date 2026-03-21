import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { host: true, port: 4173 },
  optimizeDeps: {
    include: ["@tensorflow/tfjs", "@tensorflow-models/coco-ssd"],
  },
});
