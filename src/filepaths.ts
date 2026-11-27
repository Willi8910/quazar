// Finds what looks like a file path in a line of terminal output. Whether it exists is checked
// separately (on hover, see terminals.ts); this only proposes candidates.

export interface PathMatch {
  /** The path without a trailing `:line:col`. */
  path: string;
  /** Index of its first character in the line. */
  start: number;
  /** Length of the matched text, including `:line:col`. */
  length: number;
}

// Absolute (`/…`, `~/…`, `C:\…`), `./` or `../` relative, `dir/file`, or a bare `name.ext`.
const PATH = /(?:[A-Za-z]:\\|~\/|\.{1,2}\/|\/)?(?:[\w@+.-]+[/\\])*[\w@+.-]*[\w@+-](?:\.[\w-]+)?(?::\d+(?::\d+)?)?/g;

export function findPaths(line: string): PathMatch[] {
  const out: PathMatch[] = [];
  for (const m of line.matchAll(PATH)) {
    let text = m[0];
    const start = m.index;
    const before = line.slice(0, start);
    // Part of a URL (`https://x/y`) or of a longer word (`foo=bar/baz` keeps `bar/baz`).
    if (/[a-z]+:\/\/\S*$/i.test(before) || /[\w:/\\]$/.test(before)) continue;
    text = text.replace(/[.,;:]+$/, "");
    const path = text.replace(/:\d+(?::\d+)?$/, "");
    const isPathy = /[/\\]/.test(path) || /^[\w@+-][\w@+.-]+\.[A-Za-z][\w-]{0,9}$/.test(path);
    // Numbers, versions (`v0.2.8`), "e.g." and lone dots aren't files.
    if (!isPathy || /^v?\d+(\.\d+)+$/.test(path) || path.length < 3) continue;
    out.push({ path, start, length: text.length });
  }
  return out;
}
