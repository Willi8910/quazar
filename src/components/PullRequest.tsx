// The tab's pull/merge request ("PR #142"): a link that opens it in the browser.
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PullRequest } from "../types";

export function PullRequestLink({ pr, className }: { pr: PullRequest; className: string }) {
  return (
    <a
      className={className}
      href={pr.url}
      title={`Open ${pr.label} · ${pr.url}`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void openUrl(pr.url);
      }}
    >
      {pr.label}
    </a>
  );
}
