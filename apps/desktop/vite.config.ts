import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import unocssPlugin from "unocss/vite";
import path from "node:path";

const measurementOutDir = path.resolve(
  __dirname,
  "../../output/build-measurement/desktop"
);

export default defineConfig(({ mode }) => {
  const measurementBuild = mode === "measurement";

  return {
    plugins: [unocssPlugin(), solidPlugin()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src")
      }
    },
    server: {
      port: 5173,
      strictPort: true
    },
    build: {
      target: "esnext",
      outDir: measurementBuild ? measurementOutDir : "dist",
      emptyOutDir: true,
      sourcemap: measurementBuild,
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks: {
            solid: ["solid-js"],
            tauri: [
              "@tauri-apps/api/core",
              "@tauri-apps/api/dpi",
              "@tauri-apps/api/event",
              "@tauri-apps/api/image",
              "@tauri-apps/api/window"
            ]
          }
        }
      }
    }
  };
});
