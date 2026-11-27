/** GitHub naming rules, shared by the browser form and the server checks. */

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const OWNER_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function isValidRepoName(name: string) {
  return REPO_NAME.test(name) && name !== "." && name !== ".." && !name.toLowerCase().endsWith(".git");
}

/** Accepts `owner/repo` and rejects anything that could change the API path. */
export function parseRepoFullName(value: string) {
  const [owner, repo, extra] = value.trim().split("/");
  if (extra !== undefined || !owner || !repo || !OWNER_NAME.test(owner) || !isValidRepoName(repo)) return null;
  return `${owner}/${repo}`;
}

/** Turns a project title into a repository name GitHub accepts. */
export function repoNameFromTitle(title: string) {
  const name = title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100)
    .toLowerCase();
  return name || "cognix-app";
}

/** A safe subset of Git's branch-name rules. */
export function isValidBranchName(name: string) {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.split("/").some((part) => part.startsWith("."))
  );
}
