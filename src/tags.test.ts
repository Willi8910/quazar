import { describe, expect, it } from "vitest";
import { findTag, replacementGroups, tabTags, tagCategories } from "./tags";
import type { TagDef } from "./types";

const tag = (id: string, category: string): TagDef => ({ id, name: id.toUpperCase(), category, color: "blue" });
const defs = [tag("todo", "Status"), tag("bug", "Kind"), tag("doing", "status"), tag("done", "Status"), tag("x", "")];

describe("tabTags", () => {
  it("keeps the user's order and skips deleted tags", () => {
    expect(tabTags({ tags: ["done", "gone", "todo"] }, defs).map((d) => d.id)).toEqual(["todo", "done"]);
    expect(tabTags({}, defs)).toEqual([]);
  });
});

describe("replacementGroups", () => {
  it("puts the same category first and leaves out tags already on the tab", () => {
    const { same, other } = replacementGroups(defs[0], defs, ["todo", "done"]);
    expect(same.map((d) => d.id)).toEqual(["doing"]);
    expect(other.map((d) => d.id)).toEqual(["bug", "x"]);
  });
});

describe("findTag", () => {
  it("matches names ignoring case and spaces", () => {
    expect(findTag(defs, "  bug ")?.id).toBe("bug");
    expect(findTag(defs, "")).toBeUndefined();
  });
});

it("lists categories once", () => {
  expect(tagCategories(defs)).toEqual(["Status", "Kind", "status"]);
});
