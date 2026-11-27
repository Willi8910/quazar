import { describe, expect, it } from "vitest";
import { findPaths } from "./filepaths";

const paths = (line: string) => findPaths(line).map((m) => m.path);

describe("findPaths", () => {
  it("finds absolute, home, relative and bare file paths", () => {
    expect(paths("Wrote /Users/me/proj/README.md and ~/notes/todo.txt")).toEqual([
      "/Users/me/proj/README.md",
      "~/notes/todo.txt",
    ]);
    expect(paths("Updated src/terminals.ts and ./docs/demo.mp4")).toEqual(["src/terminals.ts", "./docs/demo.mp4"]);
    expect(paths("saved to launch-posts.md.")).toEqual(["launch-posts.md"]);
  });

  it("drops a trailing line and column but keeps them in the match", () => {
    const [m] = findPaths("error at src/app.tsx:12:5 here");
    expect(m.path).toBe("src/app.tsx");
    expect("error at src/app.tsx:12:5 here".slice(m.start, m.start + m.length)).toBe("src/app.tsx:12:5");
  });

  it("finds paths inside quotes, backticks and brackets", () => {
    expect(paths("see `src/a.ts` (and 'b/c.md')")).toEqual(["src/a.ts", "b/c.md"]);
  });

  it("skips URLs, versions and plain words", () => {
    expect(paths("https://github.com/Willi8910/quazar/releases v0.2.8 e.g. hello world 1.5")).toEqual([]);
  });

  it("finds Windows paths", () => {
    expect(paths("Saved C:\\Users\\me\\a.txt")).toEqual(["C:\\Users\\me\\a.txt"]);
  });
});
