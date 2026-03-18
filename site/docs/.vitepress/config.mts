import { defineConfig } from "vitepress";

const titleOverrides = new Map<string, string>([
  ["Home", "Overview"],
  ["Support-LearnKit", "About LearnKit"],
  ["Settings-Explained", "Settings Explained"],
  ["Companion-Features", "Companion Features"],
  ["Companion-Configuration", "Configuration"],
  ["Guide-for-Free-Usage", "Guide for Free Usage"],
  ["Companion-Setting-Up", "Setting Up"],
  ["Companion-Usage", "Usage"],
]);

function toPath(page: string): string {
  return `/${page}`;
}

function toTitle(page: string): string {
  return titleOverrides.get(page) ?? page.replace(/-/g, " ");
}

function iconText(icon: string, label: string): string {
  return `${icon} ${label}`;
}

function escapeMustache(content: string): string {
  return String(content ?? "")
    .replace(/\{\{/g, "&#123;&#123;")
    .replace(/\}\}/g, "&#125;&#125;");
}

export default defineConfig({
  title: "LearnKit",
  description: "LearnKit documentation and user guides",
  base: "/LearnKit/",
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    config(md) {
      md.core.ruler.after("inline", "sprout-preserve-cloze", (state) => {
        for (const token of state.tokens) {
          if (["fence", "code_block", "html_block"].includes(token.type)) {
            token.content = escapeMustache(token.content);
            continue;
          }

          if (token.type === "inline" && token.children) {
            for (const child of token.children) {
              if (["text", "code_inline", "html_inline"].includes(child.type)) {
                child.content = escapeMustache(child.content);
              }
            }
          }
        }
      });
    },
  },
  themeConfig: {
    siteTitle: "LearnKit Docs",
    logo: {
      light: "/learnkit-mark-light.svg",
      dark: "/learnkit-mark-dark.svg",
      alt: "LearnKit",
    },
    nav: [
      { text: "Docs", link: "/" },
      { text: "GitHub", link: "https://github.com/ctrlaltwill/LearnKit" },
      { text: "Releases", link: "https://github.com/ctrlaltwill/LearnKit/releases" },
    ],
    search: {
      provider: "local",
    },
    sidebar: [
      {
        text: iconText("🏠", "Home"),
        items: [
          { text: iconText("🏠", toTitle("Home")), link: toPath("Home") },
          { text: iconText("🌲", toTitle("Wiki-Tree")), link: toPath("Wiki-Tree") },
        ],
      },
      {
        text: iconText("🚀", "Getting Started"),
        items: [
          { text: iconText("🧭", toTitle("Getting-Started")), link: toPath("Getting-Started") },
          { text: iconText("⬇️", toTitle("Installation")), link: toPath("Installation") },
          { text: iconText("🔄", toTitle("Syncing")), link: toPath("Syncing") },
          { text: iconText("📦", toTitle("Anki-Export-&-Import")), link: toPath("Anki-Export-&-Import") },
        ],
      },
      {
        text: iconText("🧠", "Workflows"),
        items: [
          { text: iconText("🗂️", toTitle("Flashcards")), link: toPath("Flashcards") },
          { text: iconText("📝", toTitle("Notes")), link: toPath("Notes") },
          { text: iconText("🧑‍🏫", toTitle("Coach")), link: toPath("Coach") },
          { text: iconText("✅", toTitle("Tests")), link: toPath("Tests") },
        ],
      },
      {
        text: iconText("🃏", "Cards"),
        items: [
          { text: iconText("🧱", toTitle("Cards")), link: toPath("Cards") },
          { text: iconText("➕", toTitle("Creating-Cards")), link: toPath("Creating-Cards") },
          { text: iconText("✏️", toTitle("Editing-Cards")), link: toPath("Editing-Cards") },
          { text: iconText("🧩", toTitle("Card-Formatting")), link: toPath("Card-Formatting") },
          { text: iconText("📋", toTitle("Card-Browser")), link: toPath("Card-Browser") },
          {
            text: iconText("🧬", "Card Types"),
            items: [
              { text: iconText("🔁", toTitle("Basic-&-Reversed-Cards")), link: toPath("Basic-&-Reversed-Cards") },
              { text: iconText("🫥", toTitle("Cloze-Cards")), link: toPath("Cloze-Cards") },
              { text: iconText("🖼️", toTitle("Image-Occlusion")), link: toPath("Image-Occlusion") },
              { text: iconText("☑️", toTitle("Multiple-Choice-Questions")), link: toPath("Multiple-Choice-Questions") },
              { text: iconText("🔢", toTitle("Ordered-Questions")), link: toPath("Ordered-Questions") },
            ],
          },
          {
            text: iconText("🚩", "Flags"),
            items: [
              { text: iconText("🚩", toTitle("Flags")), link: toPath("Flags") },
              { text: iconText("📑", toTitle("Flag-Codes")), link: toPath("Flag-Codes") },
            ],
          },
        ],
      },
      {
        text: iconText("🎓", "Study"),
        items: [
          {
            text: iconText("🔁", "Review Flow"),
            items: [
              { text: iconText("📚", toTitle("Study-Sessions")), link: toPath("Study-Sessions") },
              { text: iconText("✅", toTitle("Grading")), link: toPath("Grading") },
              { text: iconText("🗓️", toTitle("Scheduling")), link: toPath("Scheduling") },
            ],
          },
          {
            text: iconText("🧷", "Card State"),
            items: [
              { text: iconText("📦", toTitle("Burying-Cards")), link: toPath("Burying-Cards") },
              { text: iconText("⏸️", toTitle("Suspending-Cards")), link: toPath("Suspending-Cards") },
            ],
          },
          {
            text: iconText("🧭", "Scope"),
            items: [{ text: iconText("🧩", toTitle("Widget")), link: toPath("Widget") }],
          },
          {
            text: iconText("📖", "Reading View"),
            items: [
              { text: iconText("📖", toTitle("Reading-View")), link: toPath("Reading-View") },
              { text: iconText("🎨", toTitle("Reading-View-Styles")), link: toPath("Reading-View-Styles") },
              { text: iconText("🖌️", toTitle("Custom-Reading-Styles")), link: toPath("Custom-Reading-Styles") },
            ],
          },
        ],
      },
      {
        text: iconText("✨", "Companion"),
        items: [
          { text: iconText("✨", toTitle("Companion-Features")), link: toPath("Companion-Features") },
          { text: iconText("⚙️", toTitle("Companion-Configuration")), link: toPath("Companion-Configuration") },
          { text: iconText("🔧", toTitle("Companion-Setting-Up")), link: toPath("Companion-Setting-Up") },
          { text: iconText("💬", toTitle("Companion-Usage")), link: toPath("Companion-Usage") },
          { text: iconText("💸", toTitle("Guide-for-Free-Usage")), link: toPath("Guide-for-Free-Usage") },
        ],
      },
      {
        text: iconText("🔊", "Audio"),
        items: [
          { text: iconText("🗣️", toTitle("Text-to-Speech")), link: toPath("Text-to-Speech") },
          { text: iconText("🌐", toTitle("Language-Settings")), link: toPath("Language-Settings") },
        ],
      },
      {
        text: iconText("📊", "Analytics"),
        items: [
          { text: iconText("📊", toTitle("Analytics")), link: toPath("Analytics") },
          { text: iconText("📈", toTitle("Charts")), link: toPath("Charts") },
        ],
      },
      {
        text: iconText("⚙️", "Settings"),
        items: [
          { text: iconText("🧭", toTitle("Settings-Explained")), link: toPath("Settings-Explained") },
          { text: iconText("⚙️", toTitle("Settings")), link: toPath("Settings") },
          { text: iconText("🔔", toTitle("Reminders")), link: toPath("Reminders") },
          { text: iconText("⌨️", toTitle("Keyboard-Shortcuts")), link: toPath("Keyboard-Shortcuts") },
          { text: iconText("🧱", toTitle("Custom-Delimiters")), link: toPath("Custom-Delimiters") },
          { text: iconText("🛡️", toTitle("Gatekeeper")), link: toPath("Gatekeeper") },
        ],
      },
      {
        text: iconText("🛠️", "Maintenance"),
        items: [
          { text: iconText("💾", toTitle("Backups")), link: toPath("Backups") },
          { text: iconText("🌍", toTitle("Localization-Debt")), link: toPath("Localization-Debt") },
        ],
      },
      {
        text: iconText("🛡️", "Policies"),
        items: [
          { text: iconText("🛡️", toTitle("AI-Usage-Policy")), link: toPath("AI-Usage-Policy") },
        ],
      },
      {
        text: iconText("📚", "Reference"),
        items: [
          { text: iconText("🧾", toTitle("Support-LearnKit")), link: toPath("Support-LearnKit") },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/ctrlaltwill/LearnKit" }],
    editLink: {
      pattern: "https://github.com/ctrlaltwill/LearnKit/edit/main/site/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright 2026 William Guy",
    },
  },
});
