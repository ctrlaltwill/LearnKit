import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitepress";

const docsRoot = resolve(__dirname, "..");
const priority = [
  "Home.md",
  "Installation.md",
  "Creating-Cards.md",
  "Cards.md",
  "Study-Sessions.md",
  "Scheduling.md",
  "Settings.md",
  "Syncing.md",
  "Support-Sprout.md",
];

const titleOverrides = new Map<string, string>([
  ["Home", "Overview"],
  ["Support-Sprout", "About Sprout"],
]);

function stripExtension(fileName: string): string {
  return fileName.replace(/\.md$/i, "");
}

function toTitle(fileName: string): string {
  const stem = stripExtension(fileName);
  return titleOverrides.get(stem) ?? stem.replace(/-/g, " ");
}

function orderedPages(): string[] {
  const files = readdirSync(docsRoot)
    .filter((fileName) => fileName.endsWith(".md") && fileName !== "index.md")
    .sort((a, b) => a.localeCompare(b));

  const rank = new Map(priority.map((name, index) => [name, index]));
  return files.sort((a, b) => {
    const aRank = rank.get(a);
    const bRank = rank.get(b);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return a.localeCompare(b);
  });
}

export default defineConfig({
  title: "Sprout",
  description: "Sprout documentation and user guides",
  base: "/Sprout/",
  cleanUrls: true,
  lastUpdated: true,
  vue: {
    template: {
      compilerOptions: {
        // Preserve Sprout cloze syntax (e.g. {{c1::term}}) in markdown.
        delimiters: ["${", "}"],
      },
    },
  },
  themeConfig: {
    siteTitle: "Sprout Docs",
    logo: "/avatar.png",
    nav: [
      { text: "Docs", link: "/" },
      { text: "GitHub", link: "https://github.com/ctrlaltwill/Sprout" },
      { text: "Releases", link: "https://github.com/ctrlaltwill/Sprout/releases" },
    ],
    search: {
      provider: "local",
    },
    sidebar: [
      {
        text: "Guides",
        items: orderedPages().map((fileName) => ({
          text: toTitle(fileName),
          link: `/${stripExtension(fileName)}`,
        })),
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/ctrlaltwill/Sprout" }],
    editLink: {
      pattern: "https://github.com/ctrlaltwill/Sprout/edit/main/site/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright 2026 William Guy",
    },
  },
});
