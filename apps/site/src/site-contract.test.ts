import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BROWSER_CAPABILITY_DEFINITIONS } from "./lib/readiness";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Vite project-site contract", () => {
  it("uses Vite 8+ without Astro or esbuild", () => {
    const packageJson = JSON.parse(read("../package.json")) as {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const workspace = read("../../../pnpm-workspace.yaml");
    const config = read("../vite.config.ts");

    expect(packageJson.devDependencies?.vite).toMatch(/^\^?8\./);
    expect(packageJson.devDependencies).not.toHaveProperty("astro");
    expect(packageJson.devDependencies).not.toHaveProperty("@astrojs/check");
    expect(packageJson.scripts?.build).toBe("vite build");
    expect(workspace).not.toContain("esbuild");
    expect(config).toContain("rolldownOptions");
    expect(config).toContain("onboarding");
  });

  it("keeps the presentation readable without optional Lūm enhancement", () => {
    const overview = read("../index.html");
    expect(overview).toContain("data-luum-architecture-fallback");
    expect(overview).toContain("<luum-embed-graph");
    expect(overview).toContain("Direct where it matters.");
    expect(read("../src/index.ts")).toContain(
      "https://xtreemze.github.io/timeline/embed/luum-embed.js",
    );
  });

  it("keeps onboarding capability markup synchronized with the readiness contract", () => {
    const onboarding = read("../onboarding/index.html");
    for (const capability of BROWSER_CAPABILITY_DEFINITIONS) {
      expect(onboarding).toContain(`id="cap-${capability.id}"`);
      expect(onboarding).toContain(`data-required="${String(capability.required)}"`);
    }
  });

  it("uses native cross-document transitions with a reduced-motion escape hatch", () => {
    const css = read("./styles/global.css");
    expect(css).toContain("@view-transition");
    expect(css).toContain("navigation: auto");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("view-transition-name: verge-wordmark");
  });
});
