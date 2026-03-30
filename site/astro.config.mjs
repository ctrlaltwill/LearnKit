import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import starlight from "@astrojs/starlight";
import { docsSidebarTree, toStarlightSidebar } from "./src/docs-structure.mts";

const DEFAULT_BASE = "/LearnKit";
const DEFAULT_SITE = "https://ctrlaltwill.github.io";

function normalizeBase(base) {
  if (!base) return DEFAULT_BASE;
  const withLeadingSlash = base.startsWith("/") ? base : `/${base}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function resolveBase() {
  const envBase = process.env.ASTRO_BASE?.trim();
  if (envBase) return normalizeBase(envBase);

  const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1]?.trim();
  if (repoName) return normalizeBase(`/${repoName}`);

  return DEFAULT_BASE;
}

function resolveSite() {
  const envSite = process.env.ASTRO_SITE?.trim();
  if (envSite) return envSite;
  return DEFAULT_SITE;
}

export default defineConfig({
  site: resolveSite(),
  base: resolveBase(),
  vite: {
    plugins: [tailwindcss()],
    build: {
      assetsInlineLimit: 0,
    },
  },
  integrations: [
    starlight({
      title: "LearnKit",
      description: "LearnKit documentation and user guides",
      customCss: [
        "./src/styles/custom.css",
        "starlight-theme-bejamas/styles/theme.css",
      ],
      components: {
        Header: "./src/components/starlight/Header.astro",
        Hero: "./src/components/starlight/Hero.astro",
        PageTitle: "./src/components/starlight/PageTitle.astro",
        Pagination: "./src/components/starlight/Pagination.astro",
        PageFrame: "starlight-theme-bejamas/overrides/PageFrame.astro",
        SiteTitle: "starlight-theme-bejamas/overrides/SiteTitle.astro",
        MobileTableOfContents:
          "starlight-theme-bejamas/overrides/MobileTableOfContents.astro",
        Footer: "starlight-theme-bejamas/overrides/Footer.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
        ThemeProvider: "starlight-theme-bejamas/overrides/ThemeProvider.astro",
      },
      sidebar: toStarlightSidebar(docsSidebarTree),
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/ctrlaltwill/LearnKit",
        },
      ],
      credits: false,
      editLink: {
        baseUrl: "https://github.com/ctrlaltwill/LearnKit/edit/main/site/",
      },
      lastUpdated: true,
      pagination: true,
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 3,
      },
    }),
  ],
});