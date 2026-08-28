import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, parse, relative, resolve, sep } from "node:path";

import { buildTools, discoverProjects } from "./config";
import type { ProjectResult } from "./test-report";

function option(name: string, required = true): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value && required) throw new Error(`${name} requires a value`);
  return value ?? "";
}

function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function urlPath(path: string): string {
  return path.split(sep).map(encodeURIComponent).join("/");
}

function duration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${milliseconds} ms`
    : `${(milliseconds / 1000).toFixed(1)} s`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function page(title: string, body: string, depth = 0): string {
  const root = "../".repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${root}style.css">
</head>
<body>
  <main>${body}</main>
  <script src="${root}report.js"></script>
</body>
</html>
`;
}

function fallbackResult(artifact: string): ProjectResult {
  const match = basename(artifact).match(/^diagnostics-([^-]+)-(.+)-\d+$/);
  const buildTool = match?.[1] ?? "unknown";
  const project = match?.[2] ?? basename(artifact);
  return {
    project,
    projectName: project,
    buildTool,
    repository: "",
    ref: "",
    status: "unknown",
    scenarios: [],
  };
}

function readResult(artifact: string): ProjectResult {
  const path = join(artifact, ".test-report", "result.json");
  if (!existsSync(path)) return fallbackResult(artifact);
  return JSON.parse(readFileSync(path, "utf8")) as ProjectResult;
}

function mbtSummary(file: string | undefined): string {
  if (!file) return '<p class="muted">No MBT model was uploaded.</p>';
  try {
    const model = JSON.parse(readFileSync(file, "utf8")) as {
      dependencyModules?: unknown[];
      namespaces?: Record<string, unknown>;
      uncheckedSources?: unknown[];
    };
    return `<div class="metrics">
      <span><strong>${Object.keys(model.namespaces ?? {}).length}</strong> namespaces</span>
      <span><strong>${(model.dependencyModules ?? []).length}</strong> dependencies</span>
      <span><strong>${(model.uncheckedSources ?? []).length}</strong> unchecked sources</span>
    </div>`;
  } catch {
    return '<p class="muted">The uploaded MBT model is not valid JSON.</p>';
  }
}

function viewer(file: string, filesRoot: string, format: "text" | "json") {
  const path = urlPath(join("files", relative(filesRoot, file)));
  return `<details class="log-viewer">
    <summary>${escapeHtml(relative(filesRoot, file))}</summary>
    <p><a href="${path}">Open raw file</a></p>
    <pre data-source="${path}" data-format="${format}">Open this section to load the file.</pre>
  </details>`;
}

function projectPage(result: ProjectResult, filesRoot: string): string {
  const allFiles = filesBelow(filesRoot);
  const screenshots = allFiles.filter((file) => file.endsWith(".png"));
  const logs = allFiles.filter((file) => file.endsWith(".log"));
  const models = allFiles.filter((file) => basename(file) === "mbt.json");
  const link = (file: string) => urlPath(join("files", relative(filesRoot, file)));
  const screenshotGallery = (scenarioId: string) => {
    const directory = join(".test-report", "screenshots", scenarioId);
    const scenarioScreenshots = screenshots
      .filter((file) => {
        const path = relative(filesRoot, file);
        return path === directory || path.startsWith(`${directory}${sep}`);
      })
      .sort();
    const content = scenarioScreenshots.length
      ? `<div class="gallery">${scenarioScreenshots
          .map(
            (file) => `<figure>
              <a href="${link(file)}" data-gallery="${escapeHtml(scenarioId)}" data-caption="${escapeHtml(basename(file))}"><img loading="lazy" src="${link(file)}" alt="${escapeHtml(basename(file))}"></a>
              <figcaption>${escapeHtml(basename(file))}</figcaption>
            </figure>`,
          )
          .join("")}</div>`
      : '<p class="muted">No screenshots were produced for this scenario.</p>';
    return `<details class="screenshot-viewer">
      <summary>Screenshots (${scenarioScreenshots.length})</summary>
      ${content}
    </details>`;
  };
  const scenarios = result.scenarios.length
    ? result.scenarios
        .map(
          (scenario) => `<li>
            <div class="scenario-header">
              <span class="status ${scenario.status}">${scenario.status}</span>
              <strong>${escapeHtml(scenario.id)}</strong>
              <span>${escapeHtml(scenario.kind)}${scenario.durationMs === undefined ? "" : ` · ${duration(scenario.durationMs)}`}</span>
            </div>
            ${screenshotGallery(scenario.id)}
          </li>`,
        )
        .join("")
    : '<li><span class="status unknown">unknown</span>No scenario result was produced.</li>';
  const logViewers = logs
    .sort((left, right) => {
      const priority = (file: string) =>
        basename(file) === "job.log"
          ? 0
          : basename(file) === "metals.log"
            ? 1
            : 2;
      return priority(left) - priority(right) || left.localeCompare(right);
    })
    .map((file) => viewer(file, filesRoot, "text"))
    .join("");
  const modelViewers = models
    .map((file) => viewer(file, filesRoot, "json"))
    .join("");
  const repository = result.repository
    ? `<a href="https://github.com/${escapeHtml(result.repository)}/tree/${encodeURIComponent(result.ref)}">${escapeHtml(result.repository)}@${escapeHtml(result.ref)}</a>`
    : "repository unavailable";

  return page(
    `${result.buildTool} / ${result.projectName}`,
    `<nav><a href="../../../index.html">← All projects</a></nav>
    <header>
      <p class="eyebrow">${escapeHtml(titleCase(result.buildTool))}</p>
      <h1>${escapeHtml(result.projectName)}</h1>
      <p>${repository}</p>
      <span class="status large ${result.status}">${result.status}</span>
    </header>
    <section><h2>Scenarios</h2><ul class="scenarios">${scenarios}</ul></section>
    <section><h2>MBT model</h2>${mbtSummary(models[0])}${modelViewers}</section>
    <section><h2>Logs</h2>${logViewers || "<p>No logs were uploaded.</p>"}</section>`,
    3,
  );
}

const input = resolve(option("--input"));
const output = resolve(option("--output"));
const runUrl = option("--run-url", false);
const metals = option("--metals", false);

if (output === parse(output).root) {
  throw new Error(`Refusing to replace output directory: ${output}`);
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const artifacts = existsSync(input)
  ? readdirSync(input)
      .map((entry) => join(input, entry))
      .filter((entry) => statSync(entry).isDirectory())
  : [];
const artifactByProject = new Map(
  artifacts.map((artifact) => {
    const result = readResult(artifact);
    return [`${result.buildTool}/${result.project}`, { artifact, result }];
  }),
);
const results = discoverProjects().map(({ project }) => {
  const downloaded = artifactByProject.get(`${project.buildTool}/${project.id}`);
  const result: ProjectResult = downloaded?.result ?? {
    project: project.id,
    projectName: project.name,
    buildTool: project.buildTool,
    repository: project.repository,
    ref: project.ref,
    status: "unknown",
    scenarios: project.scenarios.map((scenario) => ({
      id: scenario.id,
      kind: scenario.kind,
      status: "unknown",
    })),
  };
  const destination = join(output, "projects", result.buildTool, result.project);
  const files = join(destination, "files");
  mkdirSync(files, { recursive: true });
  if (downloaded) cpSync(downloaded.artifact, files, { recursive: true });
  writeFileSync(join(destination, "index.html"), projectPage(result, files));
  return result;
});

const statusOrder = { failed: 0, unknown: 1, skipped: 2, passed: 3 };
const projectCard = (result: ProjectResult) =>
  `<a class="card result-${result.status}" href="${urlPath(join("projects", result.buildTool, result.project, "index.html"))}">
          <span class="status ${result.status}">${result.status}</span>
          <strong>${escapeHtml(result.projectName)}</strong>
          <span>${result.scenarios.length} scenario(s)</span>
        </a>`;
const projectGroups = buildTools
  .map((buildTool) => {
    const projects = results
      .filter((result) => result.buildTool === buildTool)
      .sort(
        (left, right) =>
          statusOrder[left.status] - statusOrder[right.status] ||
          left.projectName.localeCompare(right.projectName),
      );
    const cards = projects.length
      ? projects.map(projectCard).join("")
      : '<p class="muted">No projects configured.</p>';
    return `<section>
      <h2>${escapeHtml(titleCase(buildTool))}</h2>
      <div class="cards">${cards}</div>
    </section>`;
  })
  .join("");
const failedProjects = results.filter(({ status }) => status === "failed").length;
const passedProjects = results.filter(({ status }) => status === "passed").length;
const runLink = runUrl
  ? `<a href="${escapeHtml(runUrl)}">Open GitHub Actions run</a>`
  : "GitHub Actions run unavailable";

writeFileSync(
  join(output, "index.html"),
  page(
    "Metals community build report",
    `<header>
      <p class="eyebrow">Metals community build</p>
      <h1>VS Code end-to-end report</h1>
      <p>${runLink}</p>
      <p>Metals: <code>${escapeHtml(metals || "unknown")}</code></p>
      <p>Generated: ${new Date().toISOString()}</p>
      <div class="metrics">
        <span><strong>${results.length}</strong> projects</span>
        <span><strong>${passedProjects}</strong> passed</span>
        <span><strong>${failedProjects}</strong> failed</span>
      </div>
    </header>
    ${projectGroups}`,
  ),
);
writeFileSync(join(output, ".nojekyll"), "");
writeFileSync(
  join(output, "report.js"),
  `document.querySelectorAll("details.log-viewer").forEach((details) => {
  details.addEventListener("toggle", async () => {
    if (!details.open || details.dataset.loaded) return;
    details.dataset.loaded = "true";
    const viewer = details.querySelector("pre[data-source]");
    try {
      const response = await fetch(viewer.dataset.source);
      const text = await response.text();
      viewer.textContent = viewer.dataset.format === "json"
        ? JSON.stringify(JSON.parse(text), null, 2)
        : text;
    } catch (error) {
      viewer.textContent = String(error);
    }
  });
});

const galleryLinks = [...document.querySelectorAll("a[data-gallery]")];
if (galleryLinks.length) {
  const lightbox = document.createElement("dialog");
  lightbox.className = "lightbox";
  lightbox.innerHTML =
    '<button class="lightbox-close" type="button" aria-label="Close screenshot">×</button>' +
    '<button class="lightbox-previous" type="button" aria-label="Previous screenshot">←</button>' +
    '<figure><img alt=""><figcaption></figcaption></figure>' +
    '<button class="lightbox-next" type="button" aria-label="Next screenshot">→</button>';
  document.body.append(lightbox);

  const image = lightbox.querySelector("img");
  const caption = lightbox.querySelector("figcaption");
  const previous = lightbox.querySelector(".lightbox-previous");
  const next = lightbox.querySelector(".lightbox-next");
  let currentGallery = [];
  let currentIndex = 0;

  const show = (index) => {
    currentIndex = (index + currentGallery.length) % currentGallery.length;
    const link = currentGallery[currentIndex];
    image.src = link.href;
    image.alt = link.dataset.caption;
    caption.textContent =
      link.dataset.caption + " · " + (currentIndex + 1) + "/" + currentGallery.length;
    const hasMultiple = currentGallery.length > 1;
    previous.hidden = !hasMultiple;
    next.hidden = !hasMultiple;
  };
  const move = (offset) => show(currentIndex + offset);

  galleryLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      currentGallery = galleryLinks.filter(
        (candidate) => candidate.dataset.gallery === link.dataset.gallery,
      );
      show(currentGallery.indexOf(link));
      lightbox.showModal();
    });
  });
  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  lightbox.querySelector(".lightbox-close").addEventListener("click", () =>
    lightbox.close(),
  );
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) lightbox.close();
  });
  lightbox.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
  });
}
`,
);
writeFileSync(
  join(output, "style.css"),
  `:root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; background: #10131a; color: #e8ecf3; }
main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 80px; }
a { color: #8db8ff; }
header { margin: 24px 0 40px; }
h1 { margin: 4px 0 12px; font-size: clamp(2rem, 5vw, 4rem); }
h2 { margin-top: 42px; }
.eyebrow { color: #94a3b8; font-size: .78rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
.card { display: grid; gap: 8px; padding: 20px; border: 1px solid #30394a; border-radius: 14px; background: #171c26; color: inherit; text-decoration: none; }
.card:hover { border-color: #6f9fea; transform: translateY(-1px); }
.card.result-failed { border-color: #8f3544; }
.card.result-unknown { border-color: #76652c; }
.card.result-skipped { border-color: #4a5265; }
.card strong { font-size: 1.35rem; }
.status { display: inline-block; width: fit-content; padding: 3px 9px; border-radius: 999px; font-size: .75rem; font-weight: 800; text-transform: uppercase; }
.status.large { padding: 6px 12px; font-size: .9rem; }
.passed { background: #173b2a; color: #72e6a3; }
.failed { background: #481e25; color: #ff9aa9; }
.unknown { background: #3a3421; color: #f5d778; }
.skipped { background: #2a3040; color: #a6b0c3; }
.muted { color: #94a3b8; }
.metrics { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
.metrics span { padding: 9px 12px; border: 1px solid #30394a; border-radius: 9px; background: #171c26; }
.metrics strong { margin-right: 4px; font-size: 1.1rem; }
.scenarios { display: grid; gap: 10px; padding: 0; list-style: none; }
.scenarios li { padding: 12px; border: 1px solid #30394a; border-radius: 10px; }
.scenario-header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.screenshot-viewer { margin-top: 12px; border: 1px solid #30394a; border-radius: 10px; background: #171c26; }
.screenshot-viewer summary { padding: 14px; cursor: pointer; font-weight: 700; }
.screenshot-viewer .gallery { padding: 0 12px 12px; }
.screenshot-viewer .muted { padding: 0 14px 14px; }
.gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
figure { margin: 0; padding: 10px; border: 1px solid #30394a; border-radius: 10px; background: #171c26; }
figure img { display: block; width: 100%; border-radius: 6px; }
figcaption { margin-top: 8px; color: #aeb8c8; font-size: .78rem; overflow-wrap: anywhere; }
.lightbox { width: 100vw; max-width: none; height: 100vh; max-height: none; padding: 0; border: 0; background: rgba(5, 7, 11, .96); color: #e8ecf3; }
.lightbox::backdrop { background: rgba(5, 7, 11, .9); }
.lightbox[open] { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 16px; }
.lightbox figure { display: grid; place-items: center; min-width: 0; height: calc(100vh - 64px); padding: 0; border: 0; background: none; }
.lightbox figure img { width: auto; max-width: 100%; max-height: calc(100vh - 110px); object-fit: contain; }
.lightbox figcaption { text-align: center; }
.lightbox button { width: 48px; height: 48px; margin: 12px; border: 1px solid #5b6577; border-radius: 999px; background: #171c26; color: #e8ecf3; font-size: 1.6rem; cursor: pointer; }
.lightbox button:hover { background: #293246; border-color: #8db8ff; }
.lightbox-close { position: fixed; top: 8px; right: 8px; z-index: 1; }
.lightbox button[hidden] { visibility: hidden; }
.log-viewer { margin: 12px 0; border: 1px solid #30394a; border-radius: 10px; background: #171c26; }
.log-viewer summary { padding: 14px; cursor: pointer; font-weight: 700; }
.log-viewer p { padding: 0 14px; }
pre { max-height: 70vh; overflow: auto; margin: 0; padding: 16px; border-top: 1px solid #30394a; background: #0b0e13; color: #d5dbea; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
code { padding: 2px 5px; border-radius: 4px; background: #242b38; }
`,
);

console.log(`Built report for ${results.length} project(s) in ${output}`);
