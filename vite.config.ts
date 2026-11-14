import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the web app runs on :5173 and forwards API calls to the server on :8787.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/assets": "http://127.0.0.1:8787",
    },
  },
});
