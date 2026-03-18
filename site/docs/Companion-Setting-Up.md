# Companion Setting Up

Last modified: 10/03/2026

## Overview

Use this page to set up Companion (LearnKit's AI companion) safely before first use.

## 1. Enable Companion

Open **Settings -> Companion** and turn on **Enable Companion**.

Companion will not run until it is enabled and an API key is configured.

## 2. Choose provider and model

In **Settings -> Companion -> AI Provider**:

- Choose a provider: **Anthropic**, **DeepSeek**, **Google**, **OpenAI**, **OpenRouter**, **Perplexity**, **xAI**, or **Custom**.
- Choose a model for that provider.
- If using **OpenRouter**, set **OpenRouter model access** to **Free** or **Paid**.
- If using **Custom**, set **Endpoint override** to your provider URL.

## 3. Add API key

Add the API key field for your current provider.

Companion stores keys locally at:

`/.obsidian/plugins/sprout/configuration/api-keys.json`

The folder name remains `sprout` for compatibility, even though the plugin name is LearnKit.

## 4. Protect your key in Git

If your vault or `.obsidian` directory is tracked by Git, add only this file to `.gitignore`:

```gitignore
.obsidian/plugins/sprout/configuration/api-keys.json
```

## 5. Understand risks before use

Companion is a draft companion and can hallucinate or be wrong.

Before relying on responses or generated cards:

- Verify key facts against your source notes.
- Edit wording and difficulty.
- Remove content that is unsafe, low quality, or off-topic.

Read the full policy: [AI Usage Policy](./AI-Usage-Policy.md)

## Setup checklist

- Companion enabled
- Provider selected
- OpenRouter model access set (if using OpenRouter)
- Model selected
- API key saved
- `.gitignore` includes `configuration/api-keys.json` only (if needed)
- AI policy reviewed
