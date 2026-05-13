import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readSlug(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const slug = (data as { slug?: unknown }).slug;
  return isNonEmptyString(slug) ? slug : null;
}

function preserveDocsPath(entry: string) {
  const normalized = String(entry).replace(/\\/g, "/");
  const withoutExtension = normalized.replace(/\.(markdown|mdown|mkdn|mkd|mdwn|md|mdx)$/i, "");
  return withoutExtension.replace(/\/index$/i, "");
}

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: "./src/content/docs",
      pattern: "**/[^_]*.{markdown,mdown,mkdn,mkd,mdwn,md,mdx}",
      generateId: ({ entry, data }: { entry: unknown; data: unknown }) => {
        const slug = readSlug(data);
        if (slug) return slug;
        return preserveDocsPath(typeof entry === "string" ? entry : String(entry ?? ""));
      },
    }),
    schema: docsSchema(),
  }),
};