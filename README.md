# Community build projects

This branch holds only the project and scenario manifests of the Metals
community build. The test runner, the workflows, and the manifest schema live
on the `main` branch. Keeping the manifests apart lets projects and scenarios
change without touching the runner, and lets a workflow run pin the exact set
of manifests it tested.

```text
bazel/*.json    Bazel repositories
gradle/*.json   Gradle repositories
maven/*.json    Maven repositories
```

Each manifest declares one repository and the scenarios to run against it.
The schema is `project.schema.json` on `main`; manifests reference it through
its raw URL so editors validate them in any checkout. The complete reference
for every scenario kind is in the `main` README and `docs/actions.md`.

## Add or change a project

Open a pull request against this branch. The `Validate project manifests`
workflow checks out the runner from `main`, loads every manifest with the same
validation the Community Build uses, and prints the generated matrix. Only
public repositories and refs may be referenced: reports are published.

## How the Community Build uses this branch

The `Community Build` workflow on `main` checks out this branch into
`projects/` at the start of a run, records the commit, and uses that same
commit in every project job and in the report. The workflow input `projects`
selects another branch, tag, or commit of this repository, for example a
pull request branch, to test manifests before merging them here.

To work locally, check this branch out as a worktree inside a `main` checkout:

```bash
git worktree add projects projects
```

The `projects/` directory is ignored by `main`, so the manifests are available
to `npm run matrix` and `npm run test:community` without being committed there.
