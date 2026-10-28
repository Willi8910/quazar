// Pull/merge request links an agent prints in a tab (`gh pr create`, `glab mr create`, a push hint),
// shown as a badge on the tab that opens the request.
import type { PullRequest } from "./types";

const PATTERNS: [RegExp, (n: string) => string][] = [
  // GitHub: https://github.com/owner/repo/pull/142
  [/^(https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+))/, (n) => `PR #${n}`],
  // GitLab (gitlab.com or self-hosted): https://host/group/sub/repo/-/merge_requests/123
  [/^(https:\/\/[^/\s]+\/(?:[^/\s]+\/)+-\/merge_requests\/(\d+))/, (n) => `MR !${n}`],
  // Bitbucket: https://bitbucket.org/team/repo/pull-requests/7
  [/^(https:\/\/bitbucket\.org\/[^/\s]+\/[^/\s]+\/pull-requests\/(\d+))/, (n) => `PR #${n}`],
];

/** The pull/merge request `url` points at (its base URL, without /files, #anchors…), or null. */
export function pullRequest(url: string): PullRequest | null {
  for (const [pattern, label] of PATTERNS) {
    const match = pattern.exec(url);
    if (match) return { url: match[1], label: label(match[2]) };
  }
  return null;
}
