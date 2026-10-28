import { describe, expect, it } from "vitest";
import { pullRequest } from "./pr";

describe("pullRequest", () => {
  it("reads GitHub, GitLab and Bitbucket links", () => {
    expect(pullRequest("https://github.com/acme/shop/pull/142")).toEqual({
      url: "https://github.com/acme/shop/pull/142",
      label: "PR #142",
    });
    expect(pullRequest("https://gitlab.example.com/team/backend/api/-/merge_requests/87")).toEqual({
      url: "https://gitlab.example.com/team/backend/api/-/merge_requests/87",
      label: "MR !87",
    });
    expect(pullRequest("https://bitbucket.org/team/app/pull-requests/7")?.label).toBe("PR #7");
  });

  it("keeps the request's own URL, not a page inside it", () => {
    expect(pullRequest("https://github.com/acme/shop/pull/142/files#diff-1")?.url).toBe(
      "https://github.com/acme/shop/pull/142",
    );
  });

  it("ignores other links", () => {
    expect(pullRequest("https://github.com/acme/shop/issues/3")).toBeNull();
    expect(pullRequest("https://github.com/acme/shop/pulls")).toBeNull();
    expect(pullRequest("https://example.com/docs")).toBeNull();
  });
});
