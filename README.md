# Metals community build

This repository runs VS Code end-to-end tests against real Maven, Gradle, and
Bazel projects. [ExTester](https://github.com/redhat-developer/vscode-extension-tester)
drives the VS Code UI through Selenium WebDriver.

Projects are data, not CI jobs. The workflow discovers every JSON manifest below
`projects/{maven,gradle,bazel}`, creates one isolated CI job per repository, and
runs all scenarios declared by that repository. Adding a project or another MBT
import scenario does not require editing `.github/workflows/ci.yml`.

CI never starts on a push or pull request. Start it manually from **Actions →
Community Build → Run workflow** and provide the Metals source to test. The
selected source is included in the workflow run name. The input accepts:

- a branch URL, for example `https://github.com/scalameta/metals/tree/main-v2`,
- a commit URL, for example `https://github.com/scalameta/metals/commit/<sha>`,
- a tag URL, for example `https://github.com/scalameta/metals/releases/tag/<tag>`,
- `owner/repository@ref`, useful for forks, or just a ref from the default Metals
  repository.

The source input is visible in GitHub Actions. Pass only a public repository and
ref; never include credentials or tokens in the URL.

The selected repository and ref are built once. The resulting Ivy and Maven
local repositories are uploaded as a short-lived artifact and restored by every
generated project job.

## Structure

```text
community-build.json          default Metals source plus VS Code/extension versions
projects/
  project.schema.json         project/scenario manifest schema
  bazel/*.json                Bazel repositories
  maven/*.json                Maven repositories
  gradle/*.json               Gradle repositories
scripts/create-matrix.mjs     manifest discovery and CI matrix generation
scripts/run-project.mjs       isolated scenario runner for one repository
scripts/config.mjs            manifest loading and validation
scripts/extester.mjs          ExTester process wrapper
scripts/metals-source.mjs      Metals URL/ref parsing
scripts/paths.mjs             shared repository paths
scripts/validation.mjs        reusable input validation
src/mbt-import.test.ts        reusable MBT import UI scenario
```

Each repository is cloned only once per CI job. Its build tool, VS Code, and the
Metals extension are prepared once, while every scenario gets a fresh VS Code
session and a clean `.metals` directory. Matrix jobs remain isolated and may run
in parallel. The published Metals binaries are shared as a per-run artifact. A
cache keyed by `package-lock.json` and `community-build.json` shares Node
dependencies, VS Code, ChromeDriver, and installed extensions across jobs and
workflow runs. Only the preparation job can write this cache; project jobs restore
it read-only. Tests are compiled from the current checkout in every project job.
During a scenario, the CI log reports every relevant UI action and streams
`.metals/metals.log` with a `[metals]` prefix. Screenshots, VS Code logs, the MBT
model, and the complete Metals log are also uploaded as diagnostics after every
job.

## Add a repository

Add a manifest to the matching build-tool directory. For example:

```json
{
  "$schema": "../project.schema.json",
  "id": "example",
  "name": "Example",
  "buildTool": "maven",
  "repository": "organization/example",
  "ref": "main",
  "projectRoot": ".",
  "scenarios": [
    {
      "id": "import",
      "kind": "mbt-import",
      "openFile": "src/main/java/example/App.java",
      "assertions": {
        "minimumNamespaces": 1,
        "sources": ["src/main/java/example/App.java"]
      }
    }
  ]
}
```

Bazel scenarios may additionally select `each-build-target` or
`single-global-target` through `namespaceMode`.

To verify rename after a successful import, add a `rename` action:

```json
"rename": {
  "symbol": "OLD_NAME",
  "newName": "NEW_NAME",
  "expectedOccurrences": 2
}
```

The test invokes VS Code's **Rename Symbol**, saves the file, and verifies that
all expected occurrences changed.

Validate all manifests and inspect the generated CI matrix with:

```bash
npm run matrix
```

## Run a project locally

Requirements: JDK 21+, Node.js 24, the project's build tool, and Xvfb on
headless Linux.

```bash
git clone https://github.com/scalameta/metals.git workspaces/metals
git -C workspaces/metals switch main-v2
git clone --depth 1 https://github.com/SeleniumHQ/selenium.git workspaces/project
(cd workspaces/metals && \
  METALS_TEST=true METALS_VERSION=2.0.0-community-build \
  sbt --client quick-publish-local)
npm ci
COMMUNITY_BUILD_PROJECT_CONFIG=projects/bazel/selenium.json \
METALS_COMMUNITY_WORKSPACE="$PWD/workspaces/project" \
npm run test:e2e
```

Set `COMMUNITY_BUILD_SCENARIO` to run only one scenario from the manifest. On a
headless Linux machine, prefix the final command with `xvfb-run -a`.

Downloaded VS Code/ChromeDriver files, installed extensions, generated settings,
compiled tests, and community workspaces are ignored by Git.
