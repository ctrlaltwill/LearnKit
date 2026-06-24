import { defineCollection } from "astro/content/config";
import { glob } from "astro/loaders";
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- Astro glob loader types are generated at build time
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

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Astro defineCollection return type is opaque
export const collections = {
  docs: defineCollection({
    loader: glob({
      base: "./src/content/docs",
      pattern: "**/[^_]*.{markdown,mdown,mkdn,mkd,mdwn,md,mdx}",
      generateId: ({ entry, data }: { entry: string; data: Record<string, unknown> }) => {
        const slug = readSlug(data);
        if (slug) return slug;
        return preserveDocsPath(entry);
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- Starlight docsSchema return type is generated
    schema: docsSchema(),
  }),
};