import { describe, it, expect, vi } from "vitest";

import {
  persistApiKeysToDedicatedFile,
  persistTtsApiKeysToDedicatedFile,
} from "../src/platform/core/settings-storage";

type FsAdapter = {
  exists: (path: string) => Promise<boolean>;
  read: (path: string) => Promise<string>;
  write: (path: string, data: string) => Promise<void>;
  remove?: (path: string) => Promise<void>;
  mkdir?: (path: string) => Promise<void>;
};

class InMemoryAdapter implements FsAdapter {
  private readonly files = new Map<string, string>();

  private readonly dirs = new Set<string>();

  public readonly mkdirCalls: string[] = [];

  constructor(existingDirs: string[] = []) {
    for (const dir of existingDirs) this.dirs.add(dir);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirCalls.push(path);
    this.dirs.add(path);
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  file(path: string): string {
    return this.files.get(path) ?? "";
  }
}

function enoentError(path: string): Error {
  const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
  err.name = "ENOENT";
  return err;
}

describe("settings-storage dedicated key persistence", () => {
  it("creates missing nested config directories before writing API keys", async () => {
    const adapter = new InMemoryAdapter();
    const dirPath = ".obsidian/plugins/learnkit/configuration";
    const filePath = `${dirPath}/api-keys.json`;

    const ok = await persistApiKeysToDedicatedFile({
      adapter,
      dirPath,
      filePath,
      apiKeys: {
        openai: "sk-openai",
        anthropic: "",
        deepseek: "",
        xai: "",
        google: "",
        perplexity: "",
        openrouter: "",
        custom: "",
      },
    });

    expect(ok).toBe(true);
    expect(adapter.hasFile(filePath)).toBe(true);
    expect(adapter.mkdirCalls).toEqual([
      ".obsidian",
      ".obsidian/plugins",
      ".obsidian/plugins/learnkit",
      ".obsidian/plugins/learnkit/configuration",
    ]);
    expect(adapter.file(filePath)).toContain("sk-openai");
  });

  it("returns false when mkdir is unavailable and config directory does not exist", async () => {
    const dirPath = ".obsidian/plugins/learnkit/configuration";
    const filePath = `${dirPath}/api-keys.json`;

    const adapterWithoutMkdir: FsAdapter = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockResolvedValue(""),
      write: vi.fn().mockResolvedValue(undefined),
    };

    const ok = await persistApiKeysToDedicatedFile({
      adapter: adapterWithoutMkdir,
      dirPath,
      filePath,
      apiKeys: {
        openai: "sk-openai",
        anthropic: "",
        deepseek: "",
        xai: "",
        google: "",
        perplexity: "",
        openrouter: "",
        custom: "",
      },
    });

    expect(ok).toBe(false);
    expect(adapterWithoutMkdir.write).not.toHaveBeenCalled();
  });

  it("returns false when write throws ENOENT", async () => {
    const dirPath = ".obsidian/plugins/learnkit/configuration";
    const filePath = `${dirPath}/api-keys.json`;

    const adapter: FsAdapter = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue(""),
      mkdir: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockRejectedValue(enoentError(filePath)),
    };

    const ok = await persistApiKeysToDedicatedFile({
      adapter,
      dirPath,
      filePath,
      apiKeys: {
        openai: "sk-openai",
        anthropic: "",
        deepseek: "",
        xai: "",
        google: "",
        perplexity: "",
        openrouter: "",
        custom: "",
      },
    });

    expect(ok).toBe(false);
  });

  it("removes dedicated file when all API keys are cleared", async () => {
    const dirPath = ".obsidian/plugins/learnkit/configuration";
    const filePath = `${dirPath}/api-keys.json`;

    const remove = vi.fn().mockResolvedValue(undefined);
    const adapter: FsAdapter = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue(""),
      write: vi.fn().mockResolvedValue(undefined),
      remove,
      mkdir: vi.fn().mockResolvedValue(undefined),
    };

    const ok = await persistApiKeysToDedicatedFile({
      adapter,
      dirPath,
      filePath,
      apiKeys: {
        openai: "",
        anthropic: "",
        deepseek: "",
        xai: "",
        google: "",
        perplexity: "",
        openrouter: "",
        custom: "",
      },
    });

    expect(ok).toBe(true);
    expect(remove).toHaveBeenCalledWith(filePath);
  });

  it("applies the same directory guarantees for TTS API key writes", async () => {
    const adapter = new InMemoryAdapter([".obsidian", ".obsidian/plugins"]);
    const dirPath = ".obsidian/plugins/learnkit/configuration";
    const filePath = `${dirPath}/tts-api-keys.json`;

    const ok = await persistTtsApiKeysToDedicatedFile({
      adapter,
      dirPath,
      filePath,
      apiKeys: {
        elevenlabs: "",
        openai: "",
        "google-cloud": "gcp-key",
        custom: "",
      },
    });

    expect(ok).toBe(true);
    expect(adapter.hasFile(filePath)).toBe(true);
    expect(adapter.mkdirCalls).toEqual([
      ".obsidian/plugins/learnkit",
      ".obsidian/plugins/learnkit/configuration",
    ]);
    expect(adapter.file(filePath)).toContain("gcp-key");
  });
});
