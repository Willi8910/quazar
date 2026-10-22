import { describe, expect, it } from "vitest";
import { parseDiff, splitRows } from "./diff";

const DIFF = `diff --git a/a.txt b/a.txt
index 1..2 100644
--- a/a.txt
+++ b/a.txt
@@ -1,4 +1,4 @@ fn main
 one
-two
-three
+2
 four
+five
\\ No newline at end of file`;

describe("parseDiff", () => {
  it("numbers lines on each side and skips the file header", () => {
    const rows = parseDiff(DIFF);
    expect(rows[0]).toEqual({ hunk: "@@ -1,4 +1,4 @@ fn main" });
    expect(rows.slice(1)).toEqual([
      { kind: "context", old: 1, new: 1, text: "one" },
      { kind: "del", old: 2, new: null, text: "two" },
      { kind: "del", old: 3, new: null, text: "three" },
      { kind: "add", old: null, new: 2, text: "2" },
      { kind: "context", old: 4, new: 3, text: "four" },
      { kind: "add", old: null, new: 4, text: "five" },
    ]);
  });
});

describe("splitRows", () => {
  it("pairs deletions with the additions after them", () => {
    const rows = splitRows(parseDiff(DIFF));
    const show = rows.map((r) =>
      "hunk" in r ? "@@" : `${r.left ? r.left.no + r.left.text : "·"} | ${r.right ? r.right.no + r.right.text : "·"}`,
    );
    expect(show).toEqual(["@@", "1one | 1one", "2two | 22", "3three | ·", "4four | 3four", "· | 4five"]);
  });
});
