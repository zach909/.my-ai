import { defineConfig } from "vite";
import path from "node:path";

// One Node-free JavaScript file with the real engine in it, for the phone
// apps: mobile/brain/bundle/neuroclaw-brain.js, exposed as
// globalThis.NeuroClawBrain.
export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: { "node:zlib": path.resolve(import.meta.dirname, "src/zlib-shim.ts") },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "bundle"),
    emptyOutDir: true,
    minify: true,
    target: "es2022",
    lib: {
      entry: path.resolve(import.meta.dirname, "src/index.ts"),
      name: "NeuroClawBrainBundle",
      formats: ["iife"],
      fileName: () => "neuroclaw-brain.js",
    },
  },
});
