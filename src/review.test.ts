import { describe, expect, it } from "vitest";
import { reviewPrompt, ReviewComment } from "./review";

const comment = (patch: Partial<ReviewComment>): ReviewComment => ({
  id: "c",
  file: "a.ts",
  side: "new",
  line: 1,
  code: "",
  text: "fix",
  ...patch,
});

describe("reviewPrompt", () => {
  it("lists comments by file and line, with the line's code", () => {
    const text = reviewPrompt([
      comment({ file: "b.ts", line: 3, text: "rename" }),
      comment({ line: 9, code: "  return x;", text: "handle null\nand undefined" }),
      comment({ line: 2, side: "old", text: "keep this" }),
    ]);
    expect(text).toBe(
      [
        "Review comments on your uncommitted changes:",
        "",
        "- a.ts:2 (removed line)\n  keep this",
        "",
        "- a.ts:9\n  `return x;`\n  handle null\n  and undefined",
        "",
        "- b.ts:3\n  rename",
      ].join("\n"),
    );
  });
});
