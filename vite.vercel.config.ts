import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import vinext from "vinext";

export default defineConfig({
  plugins: [vinext(), nitro()],
  resolve: {
    alias: [
      {
        find: "cloudflare:workers",
        replacement: fileURLToPath(new URL("./lib/vercel-cloudflare-stub.ts", import.meta.url)),
      },
      {
        find: /^tailwindcss$/,
        replacement: fileURLToPath(new URL("./node_modules/tailwindcss/index.css", import.meta.url)),
      },
    ],
  },
});
