import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Tauri ships a static frontend. SPA mode prerenders a client shell (index.html)
// instead of the Nitro Node server used by `bun run build`.
const isTauriBuild =
  process.env.TAURI === "1" ||
  Boolean(process.env.TAURI_ENV_PLATFORM) ||
  process.env.npm_lifecycle_event === "build:tauri";

export default defineConfig({
  // Official Tauri + Vite guidance: don't clear the terminal (Rust errors),
  // fail if the configured port is busy, and don't restart on Rust rebuilds.
  clearScreen: false,
  plugins: [
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      srcDirectory: "src",
      server: { entry: "./server.ts" },
      ...(isTauriBuild
        ? {
            spa: {
              enabled: true,
              prerender: {
                outputPath: "/index.html",
              },
            },
          }
        : {}),
    }),
    nitro(),
    viteReact(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
