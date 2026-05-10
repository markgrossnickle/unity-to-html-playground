import { defineConfig } from "vite";
import { resolve } from "node:path";

// Multi-page app: each example is its own Vite entry under examples/<name>/.
// To add a new example, drop a folder there with index.html and add it to the
// `input` map below + a card on the landing page.
// `base` matches the GitHub Pages subpath (https://<user>.github.io/<repo>/).
// Override with `VITE_BASE=/` for local dev or root-domain hosting.
const base = process.env.VITE_BASE ?? "/unity-to-html-playground/";

export default defineConfig({
  root: ".",
  publicDir: "public",
  base,
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
        coloringBook: resolve(
          __dirname,
          "examples/coloring-book/index.html"
        ),
        dinoDrop: resolve(__dirname, "examples/dino-drop/index.html"),
        soundPads: resolve(__dirname, "examples/sound-pads/index.html"),
        stickerBoard: resolve(__dirname, "examples/sticker-board/index.html"),
        wreckingCrane: resolve(
          __dirname,
          "examples/wrecking-crane/index.html"
        ),
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
