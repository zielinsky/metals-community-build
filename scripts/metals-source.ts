import { ensure, gitRef, repository, text } from "./validation";

export interface MetalsSource {
  repository: string;
  ref: string;
}

function fromGitHubUrl(input: string): MetalsSource {
  const url = new URL(input);
  const isPlainGitHubUrl =
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash;
  ensure(isPlainGitHubUrl, "command line", "use a plain github.com HTTPS URL");

  const [owner, nameWithSuffix, kind, ...tail] = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const name = nameWithSuffix?.replace(/\.git$/, "");
  const isTag = kind === "releases" && tail[0] === "tag";
  const isBranchOrCommit = kind === "tree" || kind === "commit";
  const refParts = isTag ? tail.slice(1) : tail;

  ensure(
    owner && name && (isTag || isBranchOrCommit) && refParts.length > 0,
    "command line",
    "use a GitHub branch, commit, or tag URL",
  );
  return {
    repository: repository(
      `${owner}/${name}`,
      "metals repository",
      "command line",
    ),
    ref: gitRef(refParts.join("/"), "metals ref", "command line"),
  };
}

export function parseMetalsSource(
  value: string,
  defaultRepository: string,
): MetalsSource {
  const input = text(value?.trim(), "metals source", "command line");
  if (/^https?:\/\//.test(input)) return fromGitHubUrl(input);

  const repositoryAndRef = input.match(/^([^@]+)@(.+)$/);
  if (repositoryAndRef) {
    return {
      repository: repository(
        repositoryAndRef[1],
        "metals repository",
        "command line",
      ),
      ref: gitRef(repositoryAndRef[2], "metals ref", "command line"),
    };
  }

  return {
    repository: repository(
      defaultRepository,
      "metals repository",
      "command line",
    ),
    ref: gitRef(input, "metals ref", "command line"),
  };
}
