#!/usr/bin/env bash
#
# Reads the community build report from the repository's results branch and
# opens one GitHub issue per project that did not pass. The issue body mirrors
# the project's report page: scenarios with errors and collapsible
# screenshots, the MBT model summary, and collapsible logs.
#
# The report is read from raw.githubusercontent.com at the commit the results
# branch points to, and every screenshot and log in the issue links to that
# same commit, so the links keep working after later runs replace the report.
# GitHub Pages is not used.
#
# Designed for unattended runs (cron, task runners, GitHub Actions): no
# prompts; needs curl, jq, and an authenticated gh (GitHub App with
# issues:write, GH_TOKEN, or gh auth login).
#
# Usage:
#   report-issues.sh [--dry-run] [--include-unknown] [--repo OWNER/NAME]
#                    [--results-branch NAME] [--report-url URL]
#
# Configuration, in order of precedence: command-line flags, task inputs
# (VP_INPUT_<NAME>), plain environment variables, defaults.
#   REPO             repository with the results branch and the issues
#                    (default: zielinsky/metals-community-build)
#   RESULTS_BRANCH   branch that holds the report (default: results)
#   REPORT_URL       explicit report index URL; overrides the results branch
#   ISSUE_LABEL      label for created issues (default: community-build)
#   LOG_TAIL_LINES   lines of each log embedded in the issue (default: 150)
#   MAX_BODY_BYTES   GitHub issue body limit to respect (default: 65000)
#   DRY_RUN          true/1/yes prints the issues instead of creating them
#   INCLUDE_UNKNOWN  true/1/yes also reports projects without a result
#
# Output: a markdown run summary is written to $VP_OUTPUTS_DIR/<OUTPUT_PORT>.md
# (OUTPUT_PORT defaults to "summary"), else to OUTPUT_FILE, else to
# /work/output.md when that directory exists.

set -euo pipefail

is_true() { [[ "$1" =~ ^(1|[Tt][Rr][Uu][Ee]|[Yy][Ee][Ss]|[Oo][Nn])$ ]]; }

REPO="${VP_INPUT_REPO:-${REPO:-zielinsky/metals-community-build}}"
RESULTS_BRANCH="${VP_INPUT_RESULTS_BRANCH:-${RESULTS_BRANCH:-results}}"
REPORT_URL="${VP_INPUT_REPORT_URL:-${REPORT_URL:-}}"
ISSUE_LABEL="${VP_INPUT_ISSUE_LABEL:-${ISSUE_LABEL:-community-build}}"
LOG_TAIL_LINES="${VP_INPUT_LOG_TAIL_LINES:-${LOG_TAIL_LINES:-150}}"
MAX_BODY_BYTES="${VP_INPUT_MAX_BODY_BYTES:-${MAX_BODY_BYTES:-65000}}"
OUTPUT_PORT="${VP_INPUT_OUTPUT_PORT:-${OUTPUT_PORT:-summary}}"
DRY_RUN=0
INCLUDE_UNKNOWN=0
is_true "${VP_INPUT_DRY_RUN:-${DRY_RUN:-}}" && DRY_RUN=1
is_true "${VP_INPUT_INCLUDE_UNKNOWN:-${INCLUDE_UNKNOWN:-}}" && INCLUDE_UNKNOWN=1

OUTPUT_FILE="${OUTPUT_FILE:-}"
if [[ -n "${VP_OUTPUTS_DIR:-}" ]]; then
  OUTPUT_FILE="${VP_OUTPUTS_DIR}/${OUTPUT_PORT}.md"
elif [[ -z "$OUTPUT_FILE" && -d /work ]]; then
  OUTPUT_FILE=/work/output.md
fi

usage() {
  cat <<'USAGE'
Usage: report-issues.sh [--dry-run] [--include-unknown] [--repo OWNER/NAME] [--results-branch NAME] [--report-url URL]

Reads the community build report from the results branch and opens one GitHub issue per failed project.
Inputs (VP_INPUT_<NAME> or plain env): REPO, RESULTS_BRANCH, REPORT_URL, ISSUE_LABEL, LOG_TAIL_LINES,
MAX_BODY_BYTES, DRY_RUN, INCLUDE_UNKNOWN, OUTPUT_PORT. Summary: $VP_OUTPUTS_DIR/<OUTPUT_PORT>.md.
Requires curl, jq, and an authenticated gh (unless --dry-run).
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --include-unknown) INCLUDE_UNKNOWN=1 ;;
    --repo) REPO="$2"; shift ;;
    --results-branch) RESULTS_BRANCH="$2"; shift ;;
    --report-url) REPORT_URL="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

for tool in curl jq; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
HAVE_GH=0
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then HAVE_GH=1; fi
if [[ $DRY_RUN -eq 0 && $HAVE_GH -eq 0 ]]; then
  echo "gh is not available or not authenticated (GitHub App, GH_TOKEN, or gh auth login)" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/report-issues.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

# ---------------------------------------------------------------- helpers ---

fetch() { curl -sSfL --retry 3 "$1"; }
fetch_optional() { curl -sfL --retry 3 "$1" || true; }

gh_api() {
  # gh_api METHOD PATH [JSON_BODY]  (REST through the authenticated gh CLI)
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    gh api --method "$method" -H "X-GitHub-Api-Version: 2022-11-28" --input - "$path" <<<"$body"
  else
    gh api --method "$method" -H "X-GitHub-Api-Version: 2022-11-28" "$path"
  fi
}

SUMMARY_LINES=()
note() { echo "$1"; SUMMARY_LINES+=("$1"); }

html_unescape() {
  sed -e 's/&amp;/\&/g' -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&quot;/"/g' -e "s/&#39;/'/g"
}

format_duration() {
  local ms="$1"
  if [[ -z "$ms" || "$ms" == "null" ]]; then echo ""; return; fi
  if (( ms < 1000 )); then echo "${ms} ms"; else awk -v ms="$ms" 'BEGIN { printf "%.1f s", ms / 1000 }'; fi
}

status_pill() {
  case "$1" in
    passed) echo "🟢 **PASSED**" ;;
    failed) echo "🔴 **FAILED**" ;;
    skipped) echo "⚪ **SKIPPED**" ;;
    *) echo "🟡 **UNKNOWN**" ;;
  esac
}

title_case() { printf "%s%s" "$(printf "%s" "${1:0:1}" | tr "[:lower:]" "[:upper:]")" "${1:1}"; }

url_encode_path() {
  # Percent-encodes each path segment; keeps "/" as separator.
  jq -rn --arg p "$1" '$p | split("/") | map(@uri) | join("/")'
}

# ---------------------------------------------------------- locate report ---

# Resolves the commit the results branch points to, through gh when
# available and through the public API otherwise.
resolve_results_commit() {
  local sha=""
  if [[ $HAVE_GH -eq 1 ]]; then
    sha="$(gh_api GET "/repos/$REPO/branches/$RESULTS_BRANCH" 2>/dev/null | jq -r '.commit.sha // empty' || true)"
  fi
  if [[ -z "$sha" ]]; then
    sha="$(curl -sfL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/branches/$RESULTS_BRANCH" | jq -r '.commit.sha // empty' || true)"
  fi
  echo "$sha"
}

RESULTS_COMMIT=""
if [[ -n "$REPORT_URL" ]]; then
  BASE_URL="${REPORT_URL%index.html}"
  BASE_URL="${BASE_URL%/}/"
  echo "Reading report: $REPORT_URL"
else
  RESULTS_COMMIT="$(resolve_results_commit)"
  if [[ -z "$RESULTS_COMMIT" ]]; then
    echo "Branch '${RESULTS_BRANCH}' was not found in ${REPO}; run the Community Build workflow first." >&2
    exit 1
  fi
  BASE_URL="https://raw.githubusercontent.com/${REPO}/${RESULTS_COMMIT}/"
  REPORT_URL="${BASE_URL}index.html"
  echo "Reading report from ${REPO}@${RESULTS_BRANCH} (${RESULTS_COMMIT:0:7})"
fi
RESULTS_TREE_URL=""
[[ -n "$RESULTS_COMMIT" ]] && RESULTS_TREE_URL="https://github.com/${REPO}/tree/${RESULTS_COMMIT}"

# ------------------------------------------------------------ read report ---

if ! INDEX_HTML="$(fetch_optional "$REPORT_URL")" || [[ -z "$INDEX_HTML" ]]; then
  echo "No report found at ${REPORT_URL}." >&2
  [[ -n "$RESULTS_COMMIT" ]] && echo "Branch '${RESULTS_BRANCH}' has no index.html yet; run the Community Build workflow so it publishes the report there." >&2
  exit 1
fi

RUN_URL="$(grep -o 'href="https://github.com/[^"]*/actions/runs/[0-9]*"' <<<"$INDEX_HTML" | head -1 | sed 's/^href="//;s/"$//' || true)"
RUN_ID="${RUN_URL##*/}"
[[ -n "$RUN_ID" ]] || RUN_ID="unknown"
METALS_SOURCE="$(sed -n 's/.*Metals: <code>\([^<]*\)<\/code>.*/\1/p' <<<"$INDEX_HTML" | head -1 | html_unescape)"
GENERATED="$(sed -n 's/.*Generated: \([^<]*\)<.*/\1/p' <<<"$INDEX_HTML" | head -1)"

# One line per project card: "<status>\t<build tool>\t<project id>\t<project name>"
PROJECTS="$(
  tr '\n' ' ' <<<"$INDEX_HTML" |
    grep -o 'class="card result-[a-z]*" href="projects/[^"]*"[^<]*<span[^>]*>[^<]*</span>[^<]*<strong>[^<]*</strong>' |
    sed -E 's#class="card result-([a-z]+)" href="projects/([^/]+)/([^/]+)/index\.html".*<strong>([^<]*)</strong>#\1\t\2\t\3\t\4#' |
    html_unescape || true
)"
if [[ -z "$PROJECTS" ]]; then
  echo "No projects found in the report; nothing to do." >&2
  exit 1
fi

echo "Run: ${RUN_URL:-unavailable}"
echo "Metals: ${METALS_SOURCE:-unknown}"
echo "Generated: ${GENERATED:-unknown}"
echo

# ---------------------------------------------------------- project files ---

# Downloads the logs and the MBT model of a project (read from stdin as paths
# relative to the project's "files/" directory) below $1 from the files URL
# $2. The CI job log is skipped; the Actions run already has it.
download_files() {
  local target="$1" files_url="$2" rel tmp="$WORK_DIR/download.tmp"
  while read -r rel; do
    [[ -z "$rel" || "$rel" == */job.log ]] && continue
    if curl -sfL --retry 3 "${files_url}$(url_encode_path "$rel")" -o "$tmp"; then
      mkdir -p "$target/$(dirname "$rel")"
      mv "$tmp" "$target/$rel"
    fi
  done
}

# ------------------------------------------------------------- issue body ---

# Writes a collapsible log section for the local file $2, linked at $3, with
# the embedded tail limited to LOG_TAIL_LINES lines and $4 bytes.
log_section() {
  local label="$1" file="$2" url="$3" budget="$4"
  local tail_file="$WORK_DIR/log.tail"
  printf '<details>\n<summary><code>%s</code></summary>\n\n' "$label"
  printf '[Open raw file](%s)\n\n' "$url"
  if [[ -s "$file" ]]; then
    local total_lines shown_lines
    total_lines="$(wc -l <"$file" | tr -d ' ')"
    tail -n "$LOG_TAIL_LINES" "$file" | tail -c "$budget" >"$tail_file"
    shown_lines="$(wc -l <"$tail_file" | tr -d ' ')"
    if (( shown_lines < total_lines )); then
      printf '_Showing the last %s of %s lines. Open the raw file for the complete log._\n\n' "$shown_lines" "$total_lines"
    fi
    printf '```\n'
    # Make sure the embedded text cannot close the code fence early.
    sed 's/^```/` ``/' "$tail_file"
    [[ -n "$(tail -c 1 "$tail_file")" ]] && echo
    printf '```\n'
  else
    printf '_The file could not be downloaded._\n'
  fi
  printf '\n</details>\n\n'
}

# Builds the issue body for one project and writes it to the file in $1.
# $8 is the local directory with the downloaded files and $9 the public URL
# prefix of the project's files.
build_body() {
  local out="$1" build_tool="$2" project_id="$3" project_name="$4" index_status="$5" result_json="$6" project_html="$7" local_dir="$8" files_url="$9"
  local status repository ref
  if [[ -n "$result_json" ]]; then
    status="$(jq -r '.status' <<<"$result_json")"
    repository="$(jq -r '.repository // ""' <<<"$result_json")"
    ref="$(jq -r '.ref // ""' <<<"$result_json")"
  else
    status="$index_status"; repository=""; ref=""
  fi
  local repository_cell="unavailable"
  [[ -n "$repository" ]] && repository_cell="[\`${repository}@${ref}\`](https://github.com/${repository}/tree/${ref})"
  local run_cell="unavailable"
  [[ -n "$RUN_URL" ]] && run_cell="[#${RUN_ID}](${RUN_URL})"
  local metals_cell="unknown"
  if [[ "$METALS_SOURCE" == http* ]]; then
    metals_cell="[\`${METALS_SOURCE#https://github.com/}\`](${METALS_SOURCE})"
  elif [[ -n "$METALS_SOURCE" ]]; then
    metals_cell="\`${METALS_SOURCE}\`"
  fi
  local files_cell="unavailable"
  if [[ -n "$RESULTS_TREE_URL" ]]; then
    files_cell="[\`${RESULTS_BRANCH}@${RESULTS_COMMIT:0:7}\`](${RESULTS_TREE_URL}/projects/${build_tool}/${project_id}/files)"
  fi
  local generated_cell="${GENERATED:-unknown}"
  [[ "$GENERATED" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}) ]] && generated_cell="${BASH_REMATCH[1]} ${BASH_REMATCH[2]} UTC"
  local scenario_total=0 scenario_failed=0 failed_cell="none"
  if [[ -n "$result_json" ]]; then
    scenario_total="$(jq -r '.scenarios | length' <<<"$result_json")"
    scenario_failed="$(jq -r '[.scenarios[] | select(.status != "passed")] | length' <<<"$result_json")"
    failed_cell="$(jq -r '[.scenarios[] | select(.status != "passed") | "`\(.id)`"] | join(", ") | if . == "" then "none" else . end' <<<"$result_json")"
  fi
  local result_cell
  result_cell="$(status_pill "$status")"
  (( scenario_total > 0 )) && result_cell="${result_cell} · ${scenario_failed} of ${scenario_total} scenario(s) failed"
  file_url() { printf '%s%s' "$files_url" "$(url_encode_path "$1")"; }

  {
    # --- header ---
    printf '<!-- community-build project:%s/%s run:%s -->\n' "$build_tool" "$project_id" "$RUN_ID"
    printf '| | |\n|---|---|\n'
    printf '| **Project** | %s |\n' "$repository_cell"
    printf '| **Build tool** | %s |\n' "$(title_case "$build_tool")"
    printf '| **Result** | %s |\n' "$result_cell"
    printf '| **Failed scenarios** | %s |\n' "$failed_cell"
    printf '| **Metals** | %s |\n' "$metals_cell"
    printf '| **Actions run** | %s |\n' "$run_cell"
    printf '| **Report files** | %s |\n' "$files_cell"
    printf '| **Generated** | %s |\n\n' "$generated_cell"

    # --- Scenarios ---
    printf '## Scenarios\n\n'
    if [[ -z "$result_json" ]]; then
      printf '%s No scenario result was produced.\n\n' "$(status_pill unknown)"
    else
      while IFS=$'\t' read -r sc_status sc_id sc_kind sc_duration; do
        [[ -z "$sc_id" ]] && continue
        local dur; dur="$(format_duration "$sc_duration")"
        printf '### %s **%s** · %s%s\n\n' "$(status_pill "$sc_status")" "$sc_id" "$sc_kind" "${dur:+ · $dur}"
        local sc_error
        sc_error="$(jq -r --arg id "$sc_id" '.scenarios[] | select(.id == $id) | .error // ""' <<<"$result_json")"
        if [[ -n "$sc_error" ]]; then
          printf '```\n%s\n```\n\n' "$(sed 's/^```/` ``/' <<<"$sc_error")"
        fi
        local screenshots
        screenshots="$(grep -o "href=\"files/\.test-report/screenshots/${sc_id}/[^\"]*\.png\"" <<<"$project_html" |
          sed 's/^href="files\///;s/"$//' | sort -u || true)"
        local count=0
        [[ -n "$screenshots" ]] && count="$(wc -l <<<"$screenshots" | tr -d ' ')"
        printf '<details>\n<summary>Screenshots (%s)</summary>\n\n' "$count"
        if (( count > 0 )); then
          while read -r shot; do
            [[ -z "$shot" ]] && continue
            local name url; name="$(basename "$shot")"; url="$(file_url "$shot")"
            printf '<a href="%s"><img src="%s" alt="%s"></a>\n\n<sub>%s</sub>\n\n' "$url" "$url" "$name" "$name"
          done <<<"$screenshots"
        else
          printf '_No screenshots were produced for this scenario._\n\n'
        fi
        printf '</details>\n\n'
      done < <(jq -r '.scenarios[] | [.status, .id, .kind, (.durationMs // "")] | @tsv' <<<"$result_json")
    fi

    # --- MBT model ---
    printf '## MBT model\n\n'
    local model_path
    model_path="$(grep -o 'data-source="files/[^"]*mbt\.json"' <<<"$project_html" | head -1 | sed 's/^data-source="files\///;s/"$//' || true)"
    if [[ -z "$model_path" ]]; then
      printf '_No MBT model was uploaded._\n\n'
    else
      if [[ -s "$local_dir/$model_path" ]] && jq -e . "$local_dir/$model_path" >/dev/null 2>&1; then
        jq -r '"**\((.namespaces // {} | keys | length))** namespaces · **\((.dependencyModules // [] | length))** dependencies · **\((.uncheckedSources // [] | length))** unchecked sources"' "$local_dir/$model_path"
        echo
      else
        printf '_The uploaded MBT model is not valid JSON._\n\n'
      fi
      printf '<details>\n<summary><code>%s</code></summary>\n\n[Open raw file](%s)\n\n</details>\n\n' \
        "$model_path" "$(file_url "$model_path")"
    fi
  } >"$out"

  # --- Logs (embedded tails share the remaining body budget) ---
  local logs
  logs="$(grep -o 'data-source="files/[^"]*\.log"' <<<"$project_html" | sed 's/^data-source="files\///;s/"$//' | grep -v '/job\.log$' | sort -u || true)"
  # metals.log first, then the rest.
  logs="$(awk '{ n=$0; sub(/.*\//,"",n); p=(n=="metals.log")?0:1; print p "\t" $0 }' <<<"$logs" | sort | cut -f2- | sed '/^$/d')"
  printf '## Logs\n\n' >>"$out"
  if [[ -z "$logs" ]]; then
    printf 'No logs were uploaded.\n' >>"$out"
  else
    local log_count used remaining per_log
    log_count="$(wc -l <<<"$logs" | tr -d ' ')"
    used="$(wc -c <"$out" | tr -d ' ')"
    remaining=$(( MAX_BODY_BYTES - used - 1500 - log_count * 400 ))
    per_log=$(( remaining > 0 ? remaining / log_count : 0 ))
    while read -r log; do
      [[ -z "$log" ]] && continue
      log_section "$log" "$local_dir/$log" "$(file_url "$log")" "$per_log" >>"$out"
    done <<<"$logs"
  fi
}

# ---------------------------------------------------------- GitHub issues ---

# Labels are expected to exist in the repository (the GitHub App cannot create
# them). They are sent with the issue; when GitHub rejects that, the issue is
# created without labels and they are added with a second call.
create_issue() {
  # create_issue TITLE BODY_FILE LABELS_JSON -> prints the issue JSON
  local title="$1" body_file="$2" labels_json="$3" payload response
  payload="$(jq -cn --arg t "$title" --rawfile b "$body_file" --argjson labels "$labels_json" '{title:$t, body:$b, labels:$labels}')"
  if response="$(gh_api POST "/repos/$REPO/issues" "$payload" 2>&1)"; then
    echo "$response"; return 0
  fi
  echo "  warning: creating the issue with labels failed (${response}); retrying without labels" >&2
  payload="$(jq -cn --arg t "$title" --rawfile b "$body_file" '{title:$t, body:$b}')"
  response="$(gh_api POST "/repos/$REPO/issues" "$payload" 2>&1)" || { echo "$response"; return 1; }
  echo "$response"
}

find_open_issue() {
  # Prints the number of an open issue whose title starts with the project prefix.
  local prefix="$1"
  gh_api GET "/repos/$REPO/issues?state=open&labels=$ISSUE_LABEL&per_page=100" |
    jq -r --arg p "$prefix" '[.[] | select(.pull_request == null) | select(.title | startswith($p))] | .[0].number // empty'
}

issue_mentions_run() {
  local number="$1" marker="$2"
  {
    gh_api GET "/repos/$REPO/issues/$number" | jq -r '.body // ""'
    gh_api GET "/repos/$REPO/issues/$number/comments?per_page=100" | jq -r '.[].body // ""'
  } | grep -qF "$marker"
}

CREATED=0; COMMENTED=0; SKIPPED=0

while IFS=$'\t' read -r index_status build_tool project_id project_name; do
  [[ -z "$project_id" ]] && continue
  project_dir="${BASE_URL}projects/${build_tool}/${project_id}/"
  files_url="${project_dir}files/"
  result_json="$(fetch_optional "${files_url}.test-report/result.json")"
  if [[ -n "$result_json" ]] && ! jq -e . >/dev/null 2>&1 <<<"$result_json"; then
    result_json=""
  fi
  status="$index_status"
  [[ -n "$result_json" ]] && status="$(jq -r '.status' <<<"$result_json")"

  case "$status" in
    failed) ;;
    unknown) [[ $INCLUDE_UNKNOWN -eq 1 ]] || { note "- ${build_tool}/${project_id}: unknown (skipped; use --include-unknown)"; continue; } ;;
    *) note "- ${build_tool}/${project_id}: ${status}"; continue ;;
  esac

  echo "✗ ${build_tool}/${project_id}: ${status}"
  project_html="$(fetch_optional "${project_dir}index.html")"

  # Logs and the MBT model are needed locally for the log tails and metrics.
  local_dir="${WORK_DIR}/files/${build_tool}/${project_id}"
  mkdir -p "$local_dir"
  grep -o 'data-source="files/[^"]*"' <<<"$project_html" | sed 's/^data-source="files\///;s/"$//' | sort -u |
    download_files "$local_dir" "$files_url"

  failed_ids=""
  [[ -n "$result_json" ]] && failed_ids="$(jq -r '[.scenarios[] | select(.status != "passed") | .id] | join(", ")' <<<"$result_json")"
  title_prefix="[community-build] ${build_tool}/${project_id} "
  title="${title_prefix}${status}"
  [[ -n "$failed_ids" ]] && title="${title}: ${failed_ids}"
  marker="<!-- community-build project:${build_tool}/${project_id} run:${RUN_ID} -->"

  body_file="${WORK_DIR}/${build_tool}-${project_id}.md"
  build_body "$body_file" "$build_tool" "$project_id" "$project_name" "$index_status" "$result_json" "$project_html" "$local_dir" "$files_url"
  echo "  body: $(wc -c <"$body_file" | tr -d ' ') bytes"

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "----- DRY RUN: would open issue in ${REPO} -----"
    echo "Title: ${title}"
    echo
    cat "$body_file"
    echo "----------------------------------------------"
    note "- ${build_tool}/${project_id}: ${status} (dry run, issue not created): ${title}"
    CREATED=$((CREATED + 1))
    continue
  fi

  existing="$(find_open_issue "$title_prefix")"
  if [[ -n "$existing" ]]; then
    if issue_mentions_run "$existing" "$marker"; then
      note "- ${build_tool}/${project_id}: ${status}, already reported in #${existing} for run ${RUN_ID}"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi
    comment_payload="$(jq -cn --rawfile b "$body_file" --arg r "$RUN_ID" '{body: ("## 🔁 Still failing in run \($r)\n\n" + $b)}')"
    gh_api POST "/repos/$REPO/issues/$existing/comments" "$comment_payload" >/dev/null
    note "- ${build_tool}/${project_id}: ${status}, commented on existing issue #${existing}"
    COMMENTED=$((COMMENTED + 1))
    continue
  fi

  labels_json="$(jq -cn --arg a "$ISSUE_LABEL" --arg b "$build_tool" '[$a,$b]')"
  response="$(create_issue "$title" "$body_file" "$labels_json")" || {
    note "- ${build_tool}/${project_id}: FAILED to create the issue: ${response}"
    exit 1
  }
  issue_url="$(jq -r '.html_url // empty' <<<"$response" 2>/dev/null || true)"
  issue_number="$(jq -r '.number // empty' <<<"$response" 2>/dev/null || true)"
  if [[ -z "$issue_url" || -z "$issue_number" ]]; then
    note "- ${build_tool}/${project_id}: FAILED to create the issue: ${response}"
    exit 1
  fi
  # Make sure every label is on the issue, even if the create call dropped some.
  applied="$(jq -r '[.labels[]?.name] | join(", ")' <<<"$response" 2>/dev/null || true)"
  if [[ "$applied" != "${ISSUE_LABEL}, ${build_tool}" && "$applied" != "${build_tool}, ${ISSUE_LABEL}" ]]; then
    if gh_api POST "/repos/$REPO/issues/${issue_number}/labels" "$(jq -cn --argjson l "$labels_json" '{labels:$l}')" >/dev/null 2>&1; then
      applied="${ISSUE_LABEL}, ${build_tool}"
    else
      echo "  warning: could not add labels '${ISSUE_LABEL}', '${build_tool}' to #${issue_number}; check that both labels exist in ${REPO}" >&2
    fi
  fi
  echo "  labels: ${applied:-none}"
  note "- ${build_tool}/${project_id}: created ${issue_url}"
  CREATED=$((CREATED + 1))
done <<<"$PROJECTS"

echo
if [[ $DRY_RUN -eq 1 ]]; then
  RESULT="Dry run finished: ${CREATED} issue(s) would be opened."
else
  RESULT="Done: ${CREATED} created, ${COMMENTED} commented, ${SKIPPED} already reported."
fi
echo "$RESULT"

if [[ -n "$OUTPUT_FILE" ]]; then
  mkdir -p "$(dirname "$OUTPUT_FILE")" 2>/dev/null || true
  {
    echo "# Metals community build issues"
    echo
    echo "- Report: ${REPORT_URL}"
    [[ -n "$RESULTS_TREE_URL" ]] && echo "- Results branch: ${RESULTS_TREE_URL}"
    echo "- Run: ${RUN_URL:-unavailable}"
    echo "- Metals: ${METALS_SOURCE:-unknown}"
    echo "- Generated: ${GENERATED:-unknown}"
    echo
    echo "## Projects"
    echo
    printf '%s\n' "${SUMMARY_LINES[@]}"
    echo
    echo "${RESULT}"
  } >"$OUTPUT_FILE" 2>/dev/null || echo "Could not write summary to ${OUTPUT_FILE}" >&2
fi
