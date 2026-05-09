import { defineConfig } from "vite";
import { resolve } from "node:path";

// Multi-page app: each example is its own Vite entry under examples/<name>/.
// To add a new example, drop a folder there with index.html and add it to the
// `input` map below + a card on the landing page.
export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        animationPlayback: resolve(
          __dirname,
          "examples/animation-playback/index.html"
        ),
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
