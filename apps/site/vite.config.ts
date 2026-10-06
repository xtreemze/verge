import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const onGitHubActions = process.env.GITHUB_ACTIONS === "true";
const base = process.env.BASE_PATH ?? (onGitHubActions ? "/verge/" : "/");

export default defineConfig({
  base: base.endsWith("/") ? base : `${base}/`,
  envPrefix: ["VITE_", "PUBLIC_"],
  build: {
    target: "chrome140",
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        overview: fileURLToPath(new URL("./index.html", import.meta.url)),
        onboarding: fileURLToPath(new URL("./onboarding/index.html", import.meta.url)),
      },
    },
  },
});
