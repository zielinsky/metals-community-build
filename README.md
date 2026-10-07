# Metals community build

This repository runs VS Code end-to-end tests against real Maven, Gradle, and
Bazel projects. [ExTester](https://github.com/redhat-developer/vscode-extension-tester)
drives the VS Code UI through Selenium WebDriver.

Projects are data, not CI jobs. The project and scenario manifests live on the
[`projects` branch](https://github.com/zielinsky/metals-community-build/tree/projects) of this repository, separate from the
runner on `main`. At the start of a run the workflow checks that branch out
into `projects/`, records its commit, discovers every JSON manifest below
`projects/{maven,gradle,bazel}`, groups their jobs under Bazel, Maven, or
Gradle, and runs all scenarios declared by each repository. Every job of the
run uses that same manifests commit. Adding a project or scenario is a change
on the `projects` branch and does not touch `main` or
`.github/workflows/ci.yml`.

The Community Build never starts on a push or pull request. Start it manually
from **Actions → Community Build → Run workflow** and provide the Metals source
to test. The selected source is included in the workflow run name. The input
accepts:

- a branch URL, for example `https://github.com/scalameta/metals/tree/main-v2`,
- a commit URL, for example `https://github.com/scalameta/metals/commit/<sha>`,
- a tag URL, for example `https://github.com/scalameta/metals/releases/tag/<tag>`,
- `owner/repository@ref`, useful for forks, or just a ref from the default Metals
  repository.

The optional `projects` input selects another branch, tag, or commit of this
repository to take the manifests from, for example a pull request branch
against `projects`, to test new manifests before merging them. It defaults to
`projects`. The manifests commit used by a run is shown in the job summary of
the **Discover community projects** job.

The source input is visible in GitHub Actions. Pass only a public repository and
ref; never include credentials or tokens in the URL.

The selected repository and ref are built once. The resulting Ivy and Maven
local repositories are uploaded as a temporary artifact and restored by every
generated project job. A successful test run deletes that artifact immediately;
a failed run retains it for one day so **Re-run failed jobs** can reuse it.

## Structure

```text
community-build.json          default Metals source plus VS Code/extension versions
project.schema.json           project/scenario manifest schema
.github/workflows/
  ci.yml                      manual entry point and build-tool groups
  test-projects.yml           reusable per-build-tool project matrix
  schedule.yml                daily dispatch of ci.yml against main-v2
projects/                     ignored on main: checkout or worktree of the projects branch
scripts/*.ts                  typed CI setup, validation, and scenario runner
scripts/run-community-build.sh  dispatches the workflow against the latest commit of a Metals branch
scripts/report-issues.sh      opens GitHub issues for projects that failed in the report on the results branch
src/mbt-import.test.ts        reusable MBT import UI scenario
src/rename-symbol.test.ts     reusable Rename Symbol UI scenario
src/java-diagnostics.test.ts  Java diagnostics scenario
src/java-test-discovery.test.ts  Java test discovery scenario
src/java-debug-test.test.ts      Java test debugging and breakpoint scenario
src/test-support.ts           shared VS Code/MBT setup for UI scenarios
```

The `projects` branch has no runner code, only the manifests and their own
validation workflow:

```text
bazel/*.json                  Bazel repositories
maven/*.json                  Maven repositories
gradle/*.json                 Gradle repositories
.github/workflows/
  validate-projects.yml       validates every manifest on push and pull request
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

Manifests live on the `projects` branch. Open a pull request against that
branch and add a manifest to the matching build-tool directory (`bazel/`,
`maven/`, or `gradle/`). The branch's `Validate project manifests` workflow
loads every manifest with the runner from `main` and prints the generated
matrix. To work on manifests inside a `main` checkout, add the branch as a
worktree at `projects/`, which `main` ignores:

```bash
git worktree add projects projects
```

The schema stays on `main` next to the code that defines the scenario kinds,
so manifests reference it by URL. For example:

```json
{
  "$schema": "https://raw.githubusercontent.com/zielinsky/metals-community-build/main/project.schema.json",
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
without starting the test itself. Discovery and debug wait up to 120 seconds
for the icon in the already open file. They do not reopen or edit the source
to trigger discovery.

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

Java test debugging sets a breakpoint, starts the test through **Debug Test** in its gutter menu, verifies the exact stopped line, continues, and waits for a successful
test result:

```json
{
  "id": "debug-json-test",
  "kind": "java-debug-test",
  "openFile": "java/test/example/ExampleTest.java",
  "testName": "exampleTest",
  "breakpoint": { "line": 42 }
}
```

Navigation scenarios also work for Scala sources. `go-to-definition` checks
both the destination file and the text on the line where the cursor lands:

```json
{
  "id": "greeter-definition",
  "kind": "go-to-definition",
  "openFile": "src/main/java/example/App.java",
  "symbol": "Greeter",
  "definition": {
    "file": "src/main/java/example/Greeter.java",
    "text": "public class Greeter"
  }
}
```

`hover` opens **Show or Focus Hover**, checks its visible content, captures it,
and dismisses the popup:

```json
{
  "id": "greeter-documentation",
  "kind": "hover",
  "openFile": "src/main/java/example/App.java",
  "symbol": "Greeter",
  "hoverText": "Provides a greeting"
}
```

Both actions use the first occurrence of `symbol` in the source file. The Turbine
manifest exercises both actions on `TurbineOptions`.

Projects that need a different runtime JDK or a larger Metals heap can declare
`javaVersion` and `metalsServerProperties` at the manifest top level. CI uses
the selected JDK for that project and writes the server properties into the
generated VS Code settings.

Public, non-secret environment variables needed by every scenario in a project
can be declared in the manifest's top-level `environment` object. They are
passed to VS Code, Metals, and child build-tool processes. Never store tokens or
credentials there because manifests are committed to the repository.

Validate all manifests in the `projects/` worktree and inspect the generated
CI matrix with:

```bash
npm run matrix
```

## Run a project locally

Requirements: JDK 21+, Node.js 24, the project's build tool, and Xvfb on
headless Linux.

```bash
npm ci
npm run test:community -- \
  --project selenium \
  --workspace /path/to/selenium \
  --metals /path/to/metals
```

`--project` accepts either a manifest id, looked up in the `projects/`
worktree, or any manifest JSON path. The command publishes
the supplied Metals checkout locally, prepares the pinned VS Code runtime, and
runs the configured scenarios against the supplied project checkout. Use
`--scenario debug-json-test` to select one scenario. On subsequent runs,
`--skip-publish` and `--skip-setup` reuse the already published server and test
runtime. Local Metals checkouts publish as `2.0.0-SNAPSHOT` by default; use
`--metals-version` only when the checkout is configured to publish another
version. Run against a clean project checkout so a previously selected BSP
server does not bypass the MBT selection prompt.

All scenarios configured for a project run sequentially in one VS Code and
Metals session. MBT is selected and imported once, then subsequent scenarios
reuse that session. On a headless Linux machine, prefix the command with
`xvfb-run -a`.

Downloaded VS Code/ChromeDriver files, installed extensions, generated settings,
compiled tests, and community workspaces are ignored by Git.

## Start a run from the command line

`scripts/run-community-build.sh` dispatches the same workflow without the
Actions UI. It resolves the current tip of `main-v2` in `scalameta/metals` and
starts the workflow with that pinned commit URL, so the run name, the report,
and any issues opened from it keep pointing at the exact commit that was tested
after the branch moves on. It needs an authenticated `gh` with `actions:write`
(a GitHub App installation, `GH_TOKEN`, or `gh auth login`) and either `git`
or `curl` and `jq` to resolve the commit, so it can run unattended from cron
or a task runner.

```bash
scripts/run-community-build.sh
```

Add `--wait` to block until the run finishes and exit non-zero when it fails,
`--dry-run` to print the resolved commit and the dispatch command without
starting anything, and `--branch-url` to pass the branch URL instead of the
pinned commit. `--metals-ref`, `--metals-repo`, `--repo`, `--workflow-ref`,
`--projects-ref`, and `--timeout`, or the matching `METALS_REF`, `METALS_REPO`,
`REPO`, `WORKFLOW_REF`, `PROJECTS_REF`, `TIMEOUT_MINUTES`, `WAIT`,
`BRANCH_URL`, and `DRY_RUN` environment variables (also accepted as
`VP_INPUT_<NAME>` task inputs), select another branch, fork, workflow checkout,
or manifests ref; the manifests default to the `projects` branch. A markdown
summary with the commit
and run URL is written to `$VP_OUTPUTS_DIR/<OUTPUT_PORT>.md`, else to
`OUTPUT_FILE`, else to `/work/output.md` when that directory exists.

### Scheduled runs

`.github/workflows/schedule.yml` runs the same script every day at 02:00 UTC
with the repository's own `GITHUB_TOKEN`, so no GitHub App or personal token is
needed. It resolves the current tip of `main-v2` and dispatches the Community
Build with that pinned commit, exactly like a manual start. The dispatched run
URL appears in the job summary of the scheduled run. Change the `cron` line to
adjust the time, or start it from **Actions → Scheduled Community Build → Run
workflow** with another branch name to test it on demand. GitHub runs
schedules only from the default branch and pauses them after 60 days without
repository activity; re-enable the workflow from the Actions tab when that
happens.

## Open issues for failed projects

After every run, CI commits the complete static report to the `results`
branch (one commit per run, newest report at the tip). `scripts/report-issues.sh`
reads that branch through `raw.githubusercontent.com` at the commit it points
to and opens one GitHub issue per project that did not pass. The issue body
mirrors the project's report page: every scenario with its error and
collapsible screenshots, the MBT model summary, and a collapsible tail of
`metals.log`. Screenshots and logs are linked at the same pinned commit, so
they keep working after later runs replace the report. GitHub Pages is not
involved.

It needs `curl`, `jq`, and an authenticated `gh` (a GitHub App installation
with `issues:write`, `GH_TOKEN`, or `gh auth login`), so it can run unattended
from cron or a task runner. Every setting can also arrive as a task input
(`VP_INPUT_<NAME>`, for example `VP_INPUT_DRY_RUN=true`). A markdown summary
of the run is written to `$VP_OUTPUTS_DIR/<OUTPUT_PORT>.md` (port `summary` by
default), else to `OUTPUT_FILE`, else to `/work/output.md` when that directory
exists.

```bash
scripts/report-issues.sh
```

Add `--dry-run` to print the issues instead of creating them. Issues get the
`community-build` label and the build tool label (`bazel`, `maven`, `gradle`);
create those labels once, the script does not create them. When an open issue
for the same project already exists, the script adds a comment instead of
opening a duplicate, and it skips projects already reported for the same
Actions run, so repeated runs are safe. Projects without a result (`unknown`)
are ignored unless `--include-unknown` is passed. Use `--repo`,
`--results-branch`, or `--report-url` (any report index URL, for example a
downloaded report served locally), or the `REPO`, `RESULTS_BRANCH`,
`REPORT_URL`, `ISSUE_LABEL`, `LOG_TAIL_LINES`, `MAX_BODY_BYTES`, and
`OUTPUT_FILE` environment variables, to adjust the source, target, and issue
size.

## Action reference

See [all test actions with runnable examples](docs/actions.md) for the complete
scenario catalog, assertions, screenshots, retry behavior, and commands.

## Test the runner and screenshots

`npm test` runs fast regression tests for manifest validation, result aggregation,
and screenshot handling. CI runs these before project scenarios. The test that
loads every real manifest runs only when `projects/` is present.

The small Maven fixture exercises **every scenario kind**, including test discovery,
run, debug with a breakpoint, navigation, and hover, in a single VS Code session:

```bash
npm run test:smoke -- --metals /path/to/metals
# Reuse a published server and a prepared VS Code runtime:
npm run test:smoke -- --skip-publish --skip-setup
```

Set `JAVA_HOME` to a JDK supported by the Metals binaries you published (at least
JDK 21). The runner passes it explicitly to both the server and project settings. The fixture
is copied to the ignored `workspaces/smoke` directory; its checked-in sources are
never edited by the UI tests. The copy gets its own Git repository and staged
sources so MBT can index it independently of the parent `.gitignore`. Before each
VS Code session, the runner removes the workspace’s entire `.metals` directory.
A smoke run tests the reusable actions, while the
community matrix additionally tests compatibility with each real repository.

Reports are saved under `reports/local/<project>`. Every run removes old
screenshots, numbers captures separately per scenario, and checks PNG dimensions
and the final evidence for each successful action. Screenshot failures fail the
scenario. Failure screenshots are captured before cleanup where possible, and
the original test error is preserved if failure capture also fails.

```bash
npm run verify:screenshots -- reports/local/smoke
```

This checks image structure and required evidence, not the visual meaning of the
pixels; the scenario assertions check the UI state before the corresponding
capture. Inspect the PNGs to review rendering. The report builder also accepts
`--project fixtures/smoke.json` to build a report for the fixture from artifacts
with the same `.test-report` layout as CI.
