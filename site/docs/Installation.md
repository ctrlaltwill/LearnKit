# Installation

Last modified: 17/03/2026

## Install Paths

Use one of the following methods.

## BRAT Method

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Obsidian Community Plugins.
2. In BRAT settings, add `ctrlaltwill/LearnKit`.
3. BRAT installs LearnKit and keeps it updated.

## Release Method

1. Open [Releases](https://github.com/ctrlaltwill/LearnKit/releases) and download the latest release.
2. Copy `main.js`, `styles.css`, and `manifest.json` into:

   ```
   <Your Vault>/.obsidian/plugins/sprout/
   ```
   Note: the plugin directory is currently named `sprout` for compatibility.
3. Restart Obsidian, then enable **LearnKit** in **Settings → Community Plugins**.

## Source Method

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/ctrlaltwill/LearnKit.git
cd LearnKit
npm install
npm run build
```

The built plugin files are output to `dist/`. Copy or symlink that folder into your vault:

```bash
ln -s "$(pwd)/dist" "<Your Vault>/.obsidian/plugins/sprout"
```

Note: the symlink target keeps the `sprout` directory name for compatibility.

Restart Obsidian -> Settings -> Community Plugins -> Enable LearnKit.

## Dev Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Watch mode — rebuilds JS + CSS on every file change |
| `npm run build` | Production build (minified JS + CSS), copies manifest into `dist/` |

## Next Step

- [Syncing](./Syncing)
- [Flashcards](./Flashcards)