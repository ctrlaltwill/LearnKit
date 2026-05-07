/**
 * @file src/views/settings/subpages/types.ts
 * @summary Module for types.
 *
 * @exports
 *  - GithubReleaseApiItem
 *  - ReleaseNotesPage
 *  - GuidePage
 *  - GuideCategory
 */

export interface GithubReleaseApiItem {
  tag_name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface ReleaseNotesPage {
  key: string;
  label: string;
  version?: string;
  modifiedDate?: string;
  markdown: string;
}

export interface GuidePage {
  key: string;
  label: string;
  markdown: string;
  sourcePath: string;
}

export interface GuideCategorySection {
  title?: string;
  pageKeys: string[];
  /** @internal token for i18n resolution */
  _titleToken?: string;
  /** @internal fallback for i18n resolution */
  _titleFallback?: string;
}

export interface GuideCategory {
  key: string;
  label: string;
  icon: string;
  sections: GuideCategorySection[];
  /** @internal token for i18n resolution */
  _labelToken?: string;
  /** @internal fallback for i18n resolution */
  _labelFallback?: string;
}