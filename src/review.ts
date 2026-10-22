// Review comments on a diff, sent to the agent as its next prompt.

export interface ReviewComment {
  id: string;
  file: string;
  /** Which version the line number refers to: the new file, or the old one (a removed line). */
  side: "old" | "new";
  line: number;
  /** The commented line itself, for context. */
  code: string;
  text: string;
}

/** Where a comment sits: one line of one side of a file. */
export const commentKey = (c: Pick<ReviewComment, "file" | "side" | "line">) => `${c.file}:${c.side}:${c.line}`;

/** The comments as one prompt, in file and line order, each with its file, line and the line's code. */
export function reviewPrompt(comments: ReviewComment[]): string {
  const sorted = [...comments].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const items = sorted.map((c) => {
    const where = `${c.file}:${c.line}${c.side === "old" ? " (removed line)" : ""}`;
    const code = c.code.trim() ? `\n  \`${c.code.trim()}\`` : "";
    return `- ${where}${code}\n  ${c.text.trim().replace(/\n/g, "\n  ")}`;
  });
  return `Review comments on your uncommitted changes:\n\n${items.join("\n\n")}`;
}
