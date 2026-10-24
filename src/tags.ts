/** Tags on tabs: user-defined labels with a category and a colour, kept in config in the user's order. */
import type { Tab, TagColor, TagDef } from "./types";

/** The swatches: the app's One Dark palette, then a muted (dusty) row of the same hues. */
export const TAG_COLORS: Record<TagColor, string> = {
  red: "#e06c75",
  orange: "#d19a66",
  yellow: "#e5c07b",
  green: "#98c379",
  teal: "#56b6c2",
  blue: "#61afef",
  purple: "#c678dd",
  gray: "#8b919d",
  rose: "#b0868a",
  clay: "#ad9078",
  sand: "#aca184",
  sage: "#8fa287",
  sea: "#82a3a6",
  steel: "#8597ac",
  mauve: "#a28fac",
  stone: "#767c88",
};

/** The tab's tags in the user's order; ids of deleted tags are skipped. */
export function tabTags(tab: Pick<Tab, "tags">, defs: TagDef[]): TagDef[] {
  if (!tab.tags?.length) return [];
  return defs.filter((d) => tab.tags!.includes(d.id));
}

/**
 * What `current` can be swapped for: tags of its category first, then the rest. Tags already on the tab
 * (`onTab`) are left out.
 */
export function replacementGroups(current: TagDef, defs: TagDef[], onTab: string[] = []) {
  const candidates = defs.filter((d) => d.id !== current.id && !onTab.includes(d.id));
  const category = current.category.trim().toLowerCase();
  const same = candidates.filter((d) => d.category.trim().toLowerCase() === category);
  return { same, other: candidates.filter((d) => !same.includes(d)) };
}

/** The tag named `name`, ignoring case and surrounding spaces. */
export function findTag(defs: TagDef[], name: string): TagDef | undefined {
  const wanted = name.trim().toLowerCase();
  return wanted ? defs.find((d) => d.name.trim().toLowerCase() === wanted) : undefined;
}

/** The categories in use, in the order they first appear. */
export function tagCategories(defs: TagDef[]): string[] {
  return [...new Set(defs.map((d) => d.category.trim()).filter(Boolean))];
}
