import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/kitchen-timer/", // ★重要（repo名）
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "pwa-192.png",
        "pwa-512.png",
        "apple-touch-icon.png",
      ],
      manifest: {
        name: "Kitchen Timer",
        short_name: "Timer",
        start_url: "/kitchen-timer/",
        scope: "/kitchen-timer/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "/kitchen-timer/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/kitchen-timer/pwa-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wav,mp3,json}"],
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
