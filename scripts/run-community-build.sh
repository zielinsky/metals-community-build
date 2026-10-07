#!/usr/bin/env bash
#
# Starts the Community Build GitHub Actions workflow against the latest commit
# of a Metals branch (main-v2 by default).
#
# The branch tip is resolved first (git ls-remote, falling back to the GitHub
# API) and the workflow is dispatched with a pinned commit URL, so the run
# name, the report, and any issues opened from it point at exactly the commit
# that was tested, even after the branch moves on. Use --branch-url to pass the
# branch URL instead and let the workflow check out whatever is current.
#
# Designed for unattended runs (cron, task runners, GitHub Actions): no
# prompts; needs git or curl+jq to resolve the commit, and an authenticated gh
# with actions:write (GitHub App, GH_TOKEN, or gh auth login) to dispatch.
#
# Usage:
#   run-community-build.sh [--dry-run] [--wait] [--branch-url]
#                          [--repo OWNER/NAME] [--workflow-ref REF]
#                          [--projects-ref REF]
#                          [--metals-repo OWNER/NAME] [--metals-ref REF]
#                          [--timeout MINUTES]
#
# Configuration, in order of precedence: command-line flags, task inputs
# (VP_INPUT_<NAME>), plain environment variables, defaults.
#   REPO             repository that hosts the Community Build workflow
#                    (default: zielinsky/metals-community-build)
#   WORKFLOW         workflow file or name to dispatch (default: ci.yml)
#   WORKFLOW_REF     branch of REPO whose workflow definition runs
#                    (default: main)
#   PROJECTS_REF     branch, tag, or commit of REPO with the project
#                    manifests; unset uses the workflow default (projects)
#   METALS_REPO      Metals repository to test (default: scalameta/metals)
#   METALS_REF       Metals branch to test (default: main-v2)
#   BRANCH_URL       true/1/yes dispatches the branch URL instead of the
#                    resolved commit URL
#   WAIT             true/1/yes waits for the run and exits with its result
#   TIMEOUT_MINUTES  maximum wait when WAIT is set (default: 240)
#   DRY_RUN          true/1/yes prints what would be dispatched and exits
#
# Output: a markdown run summary is written to $VP_OUTPUTS_DIR/<OUTPUT_PORT>.md
# (OUTPUT_PORT defaults to "summary"), else to OUTPUT_FILE, else to
# /work/output.md when that directory exists.
#
# Exit codes: 0 dispatched (or, with --wait, the run succeeded); 1 the run
# failed or could not be dispatched; 2 bad arguments; 3 wait timed out.

set -euo pipefail

is_true() { [[ "$1" =~ ^(1|[Tt][Rr][Uu][Ee]|[Yy][Ee][Ss]|[Oo][Nn])$ ]]; }

REPO="${VP_INPUT_REPO:-${REPO:-zielinsky/metals-community-build}}"
WORKFLOW="${VP_INPUT_WORKFLOW:-${WORKFLOW:-ci.yml}}"
WORKFLOW_REF="${VP_INPUT_WORKFLOW_REF:-${WORKFLOW_REF:-main}}"
PROJECTS_REF="${VP_INPUT_PROJECTS_REF:-${PROJECTS_REF:-}}"
METALS_REPO="${VP_INPUT_METALS_REPO:-${METALS_REPO:-scalameta/metals}}"
METALS_REF="${VP_INPUT_METALS_REF:-${METALS_REF:-main-v2}}"
TIMEOUT_MINUTES="${VP_INPUT_TIMEOUT_MINUTES:-${TIMEOUT_MINUTES:-240}}"
OUTPUT_PORT="${VP_INPUT_OUTPUT_PORT:-${OUTPUT_PORT:-summary}}"
BRANCH_URL=0
WAIT=0
DRY_RUN=0
is_true "${VP_INPUT_BRANCH_URL:-${BRANCH_URL:-}}" && BRANCH_URL=1
is_true "${VP_INPUT_WAIT:-${WAIT:-}}" && WAIT=1
is_true "${VP_INPUT_DRY_RUN:-${DRY_RUN:-}}" && DRY_RUN=1

OUTPUT_FILE="${OUTPUT_FILE:-}"
if [[ -n "${VP_OUTPUTS_DIR:-}" ]]; then
  OUTPUT_FILE="${VP_OUTPUTS_DIR}/${OUTPUT_PORT}.md"
elif [[ -z "$OUTPUT_FILE" && -d /work ]]; then
  OUTPUT_FILE=/work/output.md
fi

usage() {
  cat <<'USAGE'
Usage: run-community-build.sh [--dry-run] [--wait] [--branch-url] [--repo OWNER/NAME]
                              [--workflow-ref REF] [--projects-ref REF]
                              [--metals-repo OWNER/NAME] [--metals-ref REF] [--timeout MINUTES]

Dispatches the Community Build workflow against the latest commit of a Metals branch (main-v2 by default).
Inputs (VP_INPUT_<NAME> or plain env): REPO, WORKFLOW, WORKFLOW_REF, PROJECTS_REF, METALS_REPO,
METALS_REF, BRANCH_URL, WAIT, TIMEOUT_MINUTES, DRY_RUN, OUTPUT_PORT. Summary: $VP_OUTPUTS_DIR/<OUTPUT_PORT>.md.
Requires an authenticated gh with actions:write (unless --dry-run) and git or curl+jq.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --wait) WAIT=1 ;;
    --branch-url) BRANCH_URL=1 ;;
    --repo) REPO="$2"; shift ;;
    --workflow) WORKFLOW="$2"; shift ;;
    --workflow-ref) WORKFLOW_REF="$2"; shift ;;
    --projects-ref) PROJECTS_REF="$2"; shift ;;
    --metals-repo) METALS_REPO="$2"; shift ;;
    --metals-ref) METALS_REF="$2"; shift ;;
    --timeout) TIMEOUT_MINUTES="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Invalid repository: $REPO" >&2; exit 2; }
[[ "$METALS_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Invalid Metals repository: $METALS_REPO" >&2; exit 2; }
[[ -n "$METALS_REF" && "$METALS_REF" != *" "* ]] || { echo "Invalid Metals ref: '$METALS_REF'" >&2; exit 2; }
[[ "$PROJECTS_REF" != *" "* ]] || { echo "Invalid projects ref: '$PROJECTS_REF'" >&2; exit 2; }

# Workflow inputs beyond the Metals source; empty PROJECTS_REF keeps the
# workflow's own default (the projects branch).
DISPATCH_FIELDS=()
[[ -n "$PROJECTS_REF" ]] && DISPATCH_FIELDS+=(--field "projects=${PROJECTS_REF}")
[[ "$TIMEOUT_MINUTES" =~ ^[0-9]+$ && "$TIMEOUT_MINUTES" -gt 0 ]] || { echo "Invalid timeout: $TIMEOUT_MINUTES" >&2; exit 2; }

HAVE_GH=0
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then HAVE_GH=1; fi
if [[ $DRY_RUN -eq 0 && $HAVE_GH -eq 0 ]]; then
  echo "gh is not available or not authenticated (GitHub App, GH_TOKEN, or gh auth login)" >&2
  exit 1
fi

SUMMARY_LINES=()
note() { echo "$1"; SUMMARY_LINES+=("$1"); }

write_summary() {
  [[ -n "$OUTPUT_FILE" ]] || return 0
  mkdir -p "$(dirname "$OUTPUT_FILE")" 2>/dev/null || true
  {
    echo "# Community build: ${METALS_REPO}@${METALS_REF}"
    echo
    echo "- Metals source: \`${METALS_SOURCE:-unresolved}\`"
    [[ -n "${METALS_COMMIT:-}" ]] && echo "- Commit: [\`${METALS_COMMIT:0:12}\`](https://github.com/${METALS_REPO}/commit/${METALS_COMMIT})"
    [[ -n "${RUN_URL:-}" ]] && echo "- Run: ${RUN_URL}"
    [[ -n "${RUN_CONCLUSION:-}" ]] && echo "- Conclusion: **${RUN_CONCLUSION}**"
    echo
    [[ ${#SUMMARY_LINES[@]} -gt 0 ]] && printf '%s\n' "${SUMMARY_LINES[@]}"
  } >"$OUTPUT_FILE" 2>/dev/null || echo "Could not write summary to ${OUTPUT_FILE}" >&2
}
trap write_summary EXIT

# ------------------------------------------------------ resolve the commit ---

# Prints the commit the branch currently points to. Tries git first (no
# authentication needed for a public repository), then gh, then the public API.
resolve_branch_commit() {
  local sha=""
  if command -v git >/dev/null; then
    sha="$(git ls-remote --heads "https://github.com/${METALS_REPO}.git" "refs/heads/${METALS_REF}" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
  fi
  if [[ -z "$sha" && $HAVE_GH -eq 1 ]]; then
    sha="$(gh api -H "X-GitHub-Api-Version: 2022-11-28" "/repos/${METALS_REPO}/branches/${METALS_REF}" --jq '.commit.sha // empty' 2>/dev/null || true)"
  fi
  if [[ -z "$sha" ]] && command -v curl >/dev/null && command -v jq >/dev/null; then
    sha="$(curl -sfL --retry 3 -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${METALS_REPO}/branches/${METALS_REF}" | jq -r '.commit.sha // empty' || true)"
  fi
  echo "$sha"
}

METALS_COMMIT="$(resolve_branch_commit)"
if [[ ! "$METALS_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not resolve branch '${METALS_REF}' in ${METALS_REPO} (does it exist, and is git, gh, or curl+jq available?)" >&2
  METALS_COMMIT=""
  exit 1
fi

if [[ $BRANCH_URL -eq 1 ]]; then
  METALS_SOURCE="https://github.com/${METALS_REPO}/tree/${METALS_REF}"
else
  METALS_SOURCE="https://github.com/${METALS_REPO}/commit/${METALS_COMMIT}"
fi

note "Metals ${METALS_REPO}@${METALS_REF} is at ${METALS_COMMIT:0:12}"
note "Workflow: ${REPO} ${WORKFLOW} (ref ${WORKFLOW_REF})"
note "Metals source input: ${METALS_SOURCE}"
note "Project manifests: ${PROJECTS_REF:-workflow default (projects branch)}"

if [[ $DRY_RUN -eq 1 ]]; then
  note "Dry run: not dispatching. Equivalent command:"
  note "  gh workflow run '${WORKFLOW}' --repo '${REPO}' --ref '${WORKFLOW_REF}' --field metals='${METALS_SOURCE}'${PROJECTS_REF:+ --field projects='${PROJECTS_REF}'}"
  exit 0
fi

# ---------------------------------------------------------------- dispatch ---

# Taken just before dispatching so the new run can be told apart from older
# runs with the same input (for example a re-run of the same commit).
DISPATCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

gh workflow run "$WORKFLOW" --repo "$REPO" --ref "$WORKFLOW_REF" --field "metals=${METALS_SOURCE}" ${DISPATCH_FIELDS[@]+"${DISPATCH_FIELDS[@]}"}
note "Dispatched the Community Build workflow at ${DISPATCHED_AT}"

# The dispatch API returns nothing, so locate the run by workflow, event,
# creation time, and the run name, which contains the metals input.
find_run() {
  gh run list --repo "$REPO" --workflow "$WORKFLOW" --event workflow_dispatch \
    --created ">=${DISPATCHED_AT}" --limit 20 \
    --json databaseId,displayTitle,url,createdAt,status,conclusion 2>/dev/null |
    jq -r --arg source "$METALS_SOURCE" '
      [.[] | select(.displayTitle | contains($source))]
      | sort_by(.createdAt) | reverse | .[0]
      | if . == null then empty else "\(.databaseId)\t\(.url)" end'
}

RUN_ID=""
RUN_URL=""
for _ in $(seq 1 12); do
  sleep 5
  if run="$(find_run)" && [[ -n "$run" ]]; then
    RUN_ID="${run%%$'\t'*}"
    RUN_URL="${run#*$'\t'}"
    break
  fi
done

if [[ -z "$RUN_ID" ]]; then
  note "The run was dispatched but could not be located yet; see https://github.com/${REPO}/actions/workflows/${WORKFLOW}"
  [[ $WAIT -eq 1 ]] && exit 1
  exit 0
fi

note "Run: ${RUN_URL}"
[[ $WAIT -eq 1 ]] || exit 0

# -------------------------------------------------------------------- wait ---

note "Waiting up to ${TIMEOUT_MINUTES} minutes for the run to finish"
DEADLINE=$(( $(date +%s) + TIMEOUT_MINUTES * 60 ))
RUN_CONCLUSION=""
while :; do
  state="$(gh run view "$RUN_ID" --repo "$REPO" --json status,conclusion --jq '"\(.status)\t\(.conclusion)"' 2>/dev/null || echo "unknown	")"
  status="${state%%$'\t'*}"
  conclusion="${state#*$'\t'}"
  if [[ "$status" == "completed" ]]; then
    RUN_CONCLUSION="${conclusion:-unknown}"
    break
  fi
  if (( $(date +%s) >= DEADLINE )); then
    note "Timed out after ${TIMEOUT_MINUTES} minutes; the run is still ${status}: ${RUN_URL}"
    exit 3
  fi
  sleep 60
done

note "Run finished: ${RUN_CONCLUSION} (${RUN_URL})"
[[ "$RUN_CONCLUSION" == "success" ]] || exit 1
exit 0
