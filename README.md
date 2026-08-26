# Metals community build

This repository runs VS Code end-to-end tests against real Maven, Gradle, and
Bazel projects. [ExTester](https://github.com/redhat-developer/vscode-extension-tester)
drives the VS Code UI through Selenium WebDriver.

Projects are data, not CI jobs. The workflow discovers every JSON manifest below
`projects/{maven,gradle,bazel}`, groups their jobs under Bazel, Maven, or Gradle,
and runs all scenarios declared by each repository. Adding a project or scenario
does not require editing `.github/workflows/ci.yml`.

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
local repositories are uploaded as a temporary artifact and restored by every
generated project job. A successful test run deletes that artifact immediately;
a failed run retains it for one day so **Re-run failed jobs** can reuse it.

## Structure

```text
community-build.json          default Metals source plus VS Code/extension versions
.github/workflows/
  ci.yml                      manual entry point and build-tool groups
  test-projects.yml           reusable per-build-tool project matrix
projects/
  project.schema.json         project/scenario manifest schema
  bazel/*.json                Bazel repositories
  maven/*.json                Maven repositories
  gradle/*.json               Gradle repositories
scripts/*.ts                  typed CI setup, validation, and scenario runner
src/mbt-import.test.ts        reusable MBT import UI scenario
src/rename-symbol.test.ts     reusable Rename Symbol UI scenario
src/java-diagnostics.test.ts  Java diagnostics scenario
src/java-test-discovery.test.ts  Java test discovery scenario
src/test-support.ts           shared VS Code/MBT setup for UI scenarios
```

Each repository is cloned only once per CI job. Its build tool, VS Code, Metals,
and MBT import are prepared once, then all project scenarios run sequentially in
that session. Matrix jobs remain isolated and may run in parallel. The published
Metals binaries are shared as a per-run artifact. A cache keyed by
`package-lock.json` and `community-build.json` shares Node dependencies, VS Code,
ChromeDriver, and installed extensions across jobs and workflow runs. Only the
preparation job can write this cache; project jobs restore it read-only. Tests
are compiled from the current checkout in every project job. During a scenario,
the CI log reports every relevant UI action and streams `.metals/metals.log` with
a `[metals]` prefix. The test captures VS Code after opening the file, displaying
and accepting build-server prompts, completing the MBT import, completing
feature-specific actions, and encountering a failure. The final cleanup job
keeps the current VS Code runtime cache and deletes obsolete versions of that
cache. Reusable npm, Coursier, Bazel, and Gradle dependency caches remain intact.

After all project jobs finish, including failed jobs, CI builds a static report.
Its front page lists every configured project under Bazel, Maven, or Gradle and
highlights failed projects. Each project page contains scenario results,
screenshots grouped under their scenario, the complete E2E action log, the
Metals log, and a lazy, formatted `mbt.json` viewer with namespace and dependency
counts. The report is retained as a downloadable Actions artifact for 30 days
and deployed as the repository's latest GitHub Pages site when Pages is enabled.
There is one Pages site per repository: it contains all projects from the run,
with a separate page for each project. A later workflow run replaces the live
site, while downloadable reports from earlier runs remain available as Actions
artifacts until their retention period expires.

Enable publishing once in **Settings → Pages → Build and deployment → Source →
GitHub Actions**. The Pages report is public for a public repository, so project
manifests must continue to reference only public repositories and refs and tests
must not print credentials.

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

Rename is a separate scenario and test file. Add it next to the import scenario:

```json
{
  "id": "rename-old-name",
  "kind": "rename-symbol",
  "openFile": "src/main/java/example/App.java",
  "rename": {
    "symbol": "OLD_NAME",
    "newName": "NEW_NAME",
    "expectedOccurrences": 2
  }
}
```

The rename test imports the project through MBT, invokes VS Code's **Rename
Symbol**, verifies all expected occurrences, and restores the original file.

Java diagnostics and test discovery are separate scenarios. Diagnostics verifies
that configured imports produce no errors:

```json
{
  "id": "gradle-api-imports",
  "kind": "java-diagnostics",
  "openFile": "src/test/java/example/ExampleTest.java",
  "imports": ["org.gradle.api.Project"]
}
```

Test discovery independently checks that VS Code displays a test run button
without starting the test itself:

```json
{
  "id": "test-discovery",
  "kind": "java-test-discovery",
  "openFile": "src/test/java/example/ExampleTest.java",
  "testName": "exampleTest"
}
```

Main-class execution is also a separate scenario. It clicks the `run` code
lens, waits for a project-specific success message in the Debug Console, and
then stops the application:

```json
{
  "id": "run-application",
  "kind": "java-main-run",
  "openFile": "src/main/java/example/Application.java",
  "main": {
    "className": "example.Application",
    "successOutput": "Started Application"
  }
}
```

Public, non-secret environment variables needed by every scenario in a project
can be declared in the manifest's top-level `environment` object. They are
passed to VS Code, Metals, and child build-tool processes. Never store tokens or
credentials there because manifests are committed to the repository.

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

All scenarios configured for a project run sequentially in one VS Code and
Metals session. MBT is selected and imported once, then subsequent scenarios
reuse that session. Set `COMMUNITY_BUILD_SCENARIO` to run only one scenario from
the manifest. On a headless Linux machine, prefix the final command with
`xvfb-run -a`.

Downloaded VS Code/ChromeDriver files, installed extensions, generated settings,
compiled tests, and community workspaces are ignored by Git.
