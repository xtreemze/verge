import { defineConfig } from "astro/config";

const onGitHubActions = process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
  site:
    process.env.SITE_URL ??
    (onGitHubActions
      ? "https://xtreemze.github.io"
      : "http://localhost:4321"),
  base:
    process.env.BASE_PATH ??
    (onGitHubActions ? "/verge" : "/"),
  trailingSlash: "always",
  vite: {
    build: {
      target: "chrome140"
    }
  }
});
