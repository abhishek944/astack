#!/usr/bin/env node
// Read-only release drift report and publish-target validation for Astack.
// This script never publishes, commits, pushes, or changes npm/Git state.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");
const repositoryUrl = "https://github.com/abhishek944/astack.git";
const defaultRemoteRepo = repositoryUrl;
const defaultRemoteRawBase = "https://raw.githubusercontent.com/abhishek944/astack";
const minimumSafePackNpm = "11.5.1";

// Authorization boundary: only these independent packages may be published.
const allowedPackages = new Set([
  "pi-classifier",
  "pi-decisions",
  "pi-embeddings",
  "pi-firstmate",
  "pi-grill-me",
  "pi-herdr",
  "pi-image-gen",
  "pi-langfuse",
  "pi-loop-monitor",
  "pi-research",
  "pi-review",
  "pi-routing",
  "pi-schedulers",
  "pi-tasks",
  "pi-visuals",
]);

const usage = `Usage: node scripts/release-status.mjs [options]

Options:
  --format table|json       Output format (default: table).
  --package NAME            Report or validate only packages/NAME.
  --no-pack                 Skip the read-only npm pack dry run.
  --no-remote               Skip the read-only GitHub main manifest comparison.
  --strict                  Exit nonzero when any package has a blocker or a
                            requested remote check is unavailable.
  --registry URL            Use an alternate npm registry (useful for mocks).
  --remote-repo URL         Use an alternate Git remote for main resolution.
  --remote-base-url URL     Use an alternate raw-manifest base URL or local path.
  --verify-target           Validate a workflow target instead of reporting drift.
  --version VERSION         Required with --verify-target.
  --commit SHA              Required with --verify-target; full 40-character SHA.
  --help                    Show this help.

Default output is read-only. Plain drift exits 0; use --strict for a gate.`;

function parseArgs(argv) {
  const options = {
    format: "table",
    package: null,
    noPack: false,
    noRemote: false,
    strict: false,
    registry: null,
    remoteRepo: null,
    remoteBaseUrl: null,
    verifyTarget: false,
    version: null,
    commit: null,
    help: false,
  };

  const valueOptions = new Set([
    "--format",
    "--package",
    "--registry",
    "--remote-repo",
    "--remote-base-url",
    "--version",
    "--commit",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.split("=", 2);
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    if (flag === "--no-pack") {
      options.noPack = true;
      continue;
    }
    if (flag === "--no-remote") {
      options.noRemote = true;
      continue;
    }
    if (flag === "--strict") {
      options.strict = true;
      continue;
    }
    if (flag === "--verify-target") {
      options.verifyTarget = true;
      continue;
    }
    if (!valueOptions.has(flag)) {
      throw new Error(`unknown option: ${argument}`);
    }
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value === "") {
      throw new Error(`${flag} requires a value`);
    }
    if (flag === "--format") options.format = value;
    if (flag === "--package") options.package = value;
    if (flag === "--registry") options.registry = value;
    if (flag === "--remote-repo") options.remoteRepo = value;
    if (flag === "--remote-base-url") options.remoteBaseUrl = value;
    if (flag === "--version") options.version = value;
    if (flag === "--commit") options.commit = value;
  }

  if (!["table", "json"].includes(options.format)) {
    throw new Error("--format must be table or json");
  }
  if (options.verifyTarget) {
    if (!options.package) throw new Error("--verify-target requires --package");
    if (!options.version) throw new Error("--verify-target requires --version");
    if (!options.commit) throw new Error("--verify-target requires --commit");
    if (!/^[0-9a-fA-F]{40}$/.test(options.commit)) {
      throw new Error("--commit must be a full 40-character Git SHA");
    }
  }
  return options;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) {
    return { status: 1, stdout: "", stderr: result.error.message };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function looseJson(text) {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function lastLine(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function gitOutput(args) {
  const result = run("git", args, root);
  return result.status === 0 ? result.stdout.trim() : null;
}

function porcelainPaths(output) {
  const records = output.split("\0");
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    if (!firstPath) continue;
    paths.push(firstPath);
    if (status.includes("R") || status.includes("C")) {
      const secondPath = records[++index];
      if (secondPath) paths.push(secondPath);
    }
  }
  return paths;
}

function inside(path, directory) {
  const prefix = directory + sep;
  return path === directory || path.startsWith(prefix);
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(value));
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;

  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) {
      return a.numbers[index] > b.numbers[index] ? 1 : -1;
    }
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumber = /^\d+$/.test(x);
    const yNumber = /^\d+$/.test(y);
    if (xNumber && yNumber) return Number(x) > Number(y) ? 1 : -1;
    if (xNumber !== yNumber) return xNumber ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function npmView(name, registry) {
  const args = ["view", name, "--json"];
  if (registry) args.push("--registry", registry);
  const result = run("npm", args, root);
  const payload = looseJson(result.stdout) ?? looseJson(result.stderr);
  if (result.status === 0) {
    return {
      ok: true,
      unpublished: false,
      name: payload?.name ?? name,
      latest: payload?.["dist-tags"]?.latest ?? null,
      distTags: payload?.["dist-tags"] ?? {},
      versions: Array.isArray(payload?.versions)
        ? payload.versions
        : payload?.versions
          ? [payload.versions]
          : [],
    };
  }
  if (payload?.error?.code === "E404" || result.stderr.includes("E404")) {
    return { ok: true, unpublished: true, name, latest: null, distTags: {}, versions: [] };
  }
  return {
    ok: false,
    unpublished: false,
    name,
    latest: null,
    distTags: {},
    versions: [],
    error: payload?.error?.summary || lastLine(result.stderr) || lastLine(result.stdout),
  };
}

function npmVersion() {
  const result = run("npm", ["--version"], root);
  if (result.status !== 0) return null;
  const version = result.stdout.trim().split("\n").at(-1) ?? "";
  return /^\d+\.\d+\.\d+/.test(version) ? version : null;
}

function packCapability(options) {
  if (options.noPack) {
    return { needed: false, ok: true, skipped: true, minimum: minimumSafePackNpm };
  }
  const version = npmVersion();
  if (!version) {
    return {
      needed: true,
      ok: false,
      version: null,
      minimum: minimumSafePackNpm,
      error: "cannot determine npm version; refusing to run npm pack",
    };
  }
  const comparison = compareVersions(version, minimumSafePackNpm);
  if (comparison === null || comparison < 0) {
    return {
      needed: true,
      ok: false,
      version,
      minimum: minimumSafePackNpm,
      error: `npm ${version} does not honor --ignore-scripts for npm pack --dry-run; upgrade to npm >= ${minimumSafePackNpm} or use --no-pack`,
    };
  }
  return { needed: true, ok: true, skipped: false, version, minimum: minimumSafePackNpm };
}

function packDryRun(packageName) {
  // Scripts stay disabled so the read-only report cannot rebuild or change a package.
  const result = run(
    "npm",
    ["pack", "--dry-run", "--ignore-scripts", "--json"],
    join(root, "packages", packageName),
  );
  if (result.status !== 0) {
    return { ok: false, error: lastLine(result.stderr) || lastLine(result.stdout) };
  }
  const parsed = looseJson(result.stdout);
  const info = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!info || typeof info !== "object") {
    return { ok: false, error: "unparseable npm pack output" };
  }
  return {
    ok: true,
    name: info.name ?? null,
    version: info.version ?? null,
    entryCount: info.entryCount ?? null,
    size: info.size ?? null,
    shasum: info.shasum ?? null,
    integrity: info.integrity ?? null,
  };
}

function globalGitState() {
  const status = run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
  const dirtyPaths = status.status === 0 ? porcelainPaths(status.stdout) : [];
  return {
    headCommit: gitOutput(["rev-parse", "HEAD"]),
    dirtyPaths,
    error: status.status === 0 ? null : lastLine(status.stderr),
  };
}

function remoteMainState(options) {
  const repo = options.remoteRepo ?? defaultRemoteRepo;
  const baseUrl = options.remoteBaseUrl ?? defaultRemoteRawBase;
  if (options.noRemote) {
    return { enabled: false, ok: true, skipped: true, state: "skipped", commit: null, repo, baseUrl };
  }

  const result = run("git", ["ls-remote", repo, "refs/heads/main"], root);
  if (result.status !== 0) {
    return {
      enabled: true,
      ok: false,
      skipped: false,
      state: "unavailable",
      commit: null,
      repo,
      baseUrl,
      error: lastLine(result.stderr) || lastLine(result.stdout),
    };
  }

  const line = result.stdout.split("\n").find((entry) => entry.trimEnd().endsWith("refs/heads/main"));
  const commit = line?.split(/\s+/)[0];
  if (!/^[0-9a-fA-F]{40}$/.test(commit ?? "")) {
    return {
      enabled: true,
      ok: false,
      skipped: false,
      state: "unavailable",
      commit: null,
      repo,
      baseUrl,
      error: "git ls-remote did not return a 40-character main commit",
    };
  }

  return { enabled: true, ok: true, skipped: false, state: "available", commit, repo, baseUrl };
}

function localBasePath(baseUrl) {
  if (baseUrl.startsWith("file://")) {
    try {
      return fileURLToPath(baseUrl);
    } catch {
      return null;
    }
  }
  if (baseUrl.startsWith("/") || baseUrl.startsWith("./") || baseUrl.startsWith("../")) {
    return resolve(baseUrl);
  }
  return null;
}

function classifiedError(kind, url, message, extra = {}) {
  return Object.assign(new Error(message), { kind, url, ...extra });
}

function fetchText(url, redirects = 0) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const succeed = (body) => {
      if (settled) return;
      settled = true;
      resolvePromise(body);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const failTransport = (message, cause) =>
      fail(classifiedError("transport", url, message, cause ? { cause } : {}));

    const request = httpsGet(url, { headers: { accept: "application/json" } }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 3) {
          fail(classifiedError("http", url, `too many redirects fetching ${url}`, { status }));
          return;
        }
        fetchText(new URL(response.headers.location, url).toString(), redirects + 1).then(succeed, fail);
        return;
      }
      if (status !== 200) {
        response.resume();
        fail(classifiedError("http", url, `HTTP ${status} fetching ${url}`, { status }));
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("error", (cause) => failTransport(`response stream error fetching ${url}: ${cause.message}`, cause));
      response.on("aborted", () => failTransport(`response aborted while fetching ${url}`));
      response.on("close", () => {
        if (!settled && !response.complete) failTransport(`response closed before completion fetching ${url}`);
      });
      response.on("end", () => {
        if (!response.complete) {
          failTransport(`incomplete response fetching ${url}`);
          return;
        }
        succeed(body);
      });
    });
    request.on("error", (cause) => failTransport(cause.message, cause));
  });
}

async function getRemoteManifest(remote, packageName) {
  if (!remote.enabled) return { ok: false, state: "skipped", version: null, name: null };
  if (!remote.ok) return { ok: false, state: "unavailable", version: null, name: null, error: remote.error };

  const manifestPath = `packages/${packageName}/package.json`;
  let text;
  try {
    const localBase = localBasePath(remote.baseUrl);
    if (localBase) {
      text = readFileSync(join(localBase, remote.commit, manifestPath), "utf8");
    } else {
      text = await fetchText(`${remote.baseUrl.replace(/\/$/, "")}/${remote.commit}/${manifestPath}`);
    }
  } catch (error) {
    const kind = error.kind ?? "local";
    const missing = (kind === "local" && error.code === "ENOENT") || (kind === "http" && error.status === 404);
    return {
      ok: false,
      state: missing ? "no-remote-manifest" : "unavailable",
      version: null,
      name: null,
      errorKind: kind,
      status: error.status ?? null,
      error: error.message,
    };
  }

  try {
    const manifest = JSON.parse(text);
    return { ok: true, state: "available", version: manifest.version ?? null, name: manifest.name ?? null };
  } catch (error) {
    return {
      ok: false,
      state: "check-failed",
      version: null,
      name: null,
      errorKind: "parse",
      error: error.message,
    };
  }
}

function compareRemoteManifest(remote, remoteManifest, registry, localVersion, packageName) {
  if (!remote.enabled) return { state: "skipped", version: null, name: null, commit: null };
  if (!remote.ok) {
    return { state: "unavailable", version: null, name: null, commit: null, error: remote.error };
  }
  if (!remoteManifest.ok) {
    return {
      state: remoteManifest.state,
      version: null,
      name: null,
      commit: remote.commit,
      errorKind: remoteManifest.errorKind ?? null,
      status: remoteManifest.status ?? null,
      error: remoteManifest.error,
    };
  }

  const remoteVersion = remoteManifest.version;
  const expectedName = `@abhishek944/${packageName}`;
  if (parseVersion(remoteVersion) === null) {
    return {
      state: "check-failed",
      version: remoteVersion,
      name: remoteManifest.name,
      commit: remote.commit,
      error: `remote manifest version is not valid SemVer: ${remoteVersion}`,
    };
  }
  if (remoteManifest.name !== expectedName) {
    return {
      state: "check-failed",
      version: remoteVersion,
      name: remoteManifest.name,
      commit: remote.commit,
      error: `remote manifest name is ${remoteManifest.name}, expected ${expectedName}`,
    };
  }
  if (!registry.ok) {
    return {
      state: "check-failed",
      version: remoteVersion,
      name: remoteManifest.name,
      commit: remote.commit,
      error: registry.error,
    };
  }
  if (registry.unpublished) {
    return {
      state: "remote-unpublished",
      version: remoteVersion,
      name: remoteManifest.name,
      commit: remote.commit,
      published: false,
      matchesLatest: false,
      matchesLocal: remoteVersion === localVersion,
    };
  }

  const published = registry.versions.includes(remoteVersion);
  const npmAhead = registry.versions.some((version) => {
    const comparison = compareVersions(version, remoteVersion);
    return comparison !== null && comparison > 0;
  });
  const state = npmAhead ? "npm-ahead" : published ? "in-sync" : "remote-ahead";
  return {
    state,
    version: remoteVersion,
    name: remoteManifest.name,
    commit: remote.commit,
    published,
    matchesLatest: remoteVersion === registry.latest,
    matchesLocal: remoteVersion === localVersion,
    latest: registry.latest,
  };
}

function repositoryFields(manifest, packageName) {
  return (
    manifest.repository?.type === "git" &&
    manifest.repository?.url === repositoryUrl &&
    manifest.repository?.directory === `packages/${packageName}` &&
    manifest.publishConfig?.access === "public"
  );
}

async function checkPackage(packageName, options, gitState, remote, packCap) {
  const manifestPath = join(root, "packages", packageName, "package.json");
  if (!existsSync(manifestPath)) return null;

  let manifest;
  try {
    manifest = readJsonFile(manifestPath);
  } catch (error) {
    return {
      package: packageName,
      state: "check-failed",
      publishable: false,
      errors: [error.message],
      blockers: ["check-failed"],
    };
  }

  const authorized = allowedPackages.has(packageName) && manifest.private !== true;
  if (!authorized) {
    return {
      package: packageName,
      name: manifest.name ?? null,
      version: manifest.version ?? null,
      state: "private-skipped",
      publishable: false,
      expectedTag: `${packageName}/v${manifest.version}`,
      tagStatus: "informational",
      remote: { state: "skipped" },
      errors: [],
      blockers: [],
    };
  }

  const errors = [];
  const blockers = [];
  const localVersion = manifest.version;
  const expectedTag = `${packageName}/v${localVersion}`;
  const registry = npmView(manifest.name, options.registry);
  if (!registry.ok) {
    errors.push(registry.error);
    blockers.push("check-failed");
  }

  const publishedVersions = new Set(registry.versions);
  const localVersionPublished = publishedVersions.has(localVersion);
  const registryAhead = registry.versions.some((version) => {
    const comparison = compareVersions(version, localVersion);
    return comparison !== null && comparison > 0;
  });
  if (localVersionPublished && !registry.unpublished) blockers.push("version-published");
  if (registryAhead) blockers.push("registry-ahead");

  const remoteManifest = await getRemoteManifest(remote, packageName);
  const remoteComparison = compareRemoteManifest(remote, remoteManifest, registry, localVersion, packageName);

  const tagCommit = gitOutput(["rev-list", "-n", "1", expectedTag]);
  const tagMatches = Boolean(tagCommit && gitState.headCommit && tagCommit === gitState.headCommit);
  const behind = tagCommit ? gitOutput(["rev-list", "--count", `${expectedTag}..HEAD`]) : null;
  const tagStatus = !tagCommit ? "missing" : tagMatches ? "head" : "behind";

  const dirtyPaths = gitState.dirtyPaths.filter((path) => inside(path, `packages/${packageName}`));
  if (dirtyPaths.length > 0) blockers.push("dirty-tree");
  if (gitState.error) {
    errors.push(gitState.error);
    if (!blockers.includes("check-failed")) blockers.push("check-failed");
  }

  if (!repositoryFields(manifest, packageName)) {
    errors.push("repository/publishConfig metadata does not match Astack trusted publishing");
    if (!blockers.includes("check-failed")) blockers.push("check-failed");
  }

  let pack = null;
  if (!options.noPack) {
    if (!packCap.ok) {
      pack = { ok: false, state: "unsupported", error: packCap.error };
      errors.push(packCap.error);
      if (!blockers.includes("check-failed")) blockers.push("check-failed");
    } else {
      pack = packDryRun(packageName);
      if (!pack.ok) {
        errors.push(pack.error);
        if (!blockers.includes("check-failed")) blockers.push("check-failed");
      } else if (pack.name !== manifest.name || pack.version !== manifest.version) {
        errors.push(`pack identity ${pack.name}@${pack.version} does not match ${manifest.name}@${manifest.version}`);
        if (!blockers.includes("check-failed")) blockers.push("check-failed");
      }
    }
  }

  let state = "in-sync";
  if (registry.unpublished) state = "unpublished";
  else if (registryAhead) state = "registry-ahead";
  else if (!localVersionPublished) state = "local-ahead";
  if (blockers.includes("dirty-tree") && state === "in-sync") state = "dirty-tree";
  if (errors.length > 0) state = "check-failed";

  return {
    package: packageName,
    name: manifest.name,
    version: localVersion,
    registry: registry.unpublished ? "unpublished" : registry.latest,
    distTags: registry.distTags,
    publishedVersions: registry.versions,
    expectedTag,
    tagCommit,
    tagStatus,
    headCommit: gitState.headCommit,
    commitsBehindTag: behind,
    remote: remoteComparison,
    dirtyPaths,
    pack,
    state,
    publishable: blockers.length === 0,
    errors,
    blockers,
  };
}

async function makeReport(options) {
  const gitState = globalGitState();
  const remote = remoteMainState(options);
  const packCap = packCapability(options);
  const directories = readdirSync(packagesDir).sort();
  const selected = options.package ? [options.package] : directories;
  if (options.package && !selected.every((name) => existsSync(join(root, "packages", name, "package.json")))) {
    throw new Error(`unknown package: ${options.package}`);
  }

  const packages = [];
  for (const directory of selected) {
    const report = await checkPackage(directory, options, gitState, remote, packCap);
    if (report) packages.push(report);
  }

  const checkedRemotes = packages.filter((entry) => entry.remote && entry.remote.state !== "skipped");
  return {
    root,
    registry: options.registry ?? "npm default",
    packCapability: packCap,
    remote: {
      enabled: remote.enabled,
      state: remote.state,
      commit: remote.commit,
      repo: remote.repo,
      baseUrl: remote.baseUrl,
      error: remote.error ?? null,
    },
    headCommit: gitState.headCommit,
    summary: {
      packages: packages.length,
      publishable: packages.filter((entry) => entry.publishable).length,
      blocked: packages.filter((entry) => !entry.publishable && entry.state !== "private-skipped").length,
      skipped: packages.filter((entry) => entry.state === "private-skipped").length,
      failed: packages.filter((entry) => entry.state === "check-failed").length,
      remoteChecked: checkedRemotes.length,
      remoteUnavailable: checkedRemotes.filter((entry) => entry.remote.state === "unavailable").length,
      remoteFailed: checkedRemotes.filter((entry) => entry.remote.state === "check-failed").length,
    },
    packages,
  };
}

function verifyTarget(options) {
  const errors = [];
  const packageDir = join(root, "packages", options.package);
  const manifestPath = join(packageDir, "package.json");
  if (!allowedPackages.has(options.package)) {
    errors.push(`package not in the publish allowlist: ${options.package}`);
  }
  if (!existsSync(manifestPath)) {
    errors.push(`missing manifest: packages/${options.package}/package.json`);
    return { ok: false, package: options.package, version: options.version, commit: options.commit, errors };
  }

  const manifest = readJsonFile(manifestPath);
  const expectedName = `@abhishek944/${options.package}`;
  if (manifest.name !== expectedName) errors.push(`manifest name is ${manifest.name}, expected ${expectedName}`);
  if (manifest.version !== options.version) {
    errors.push(`manifest version is ${manifest.version}, expected ${options.version}`);
  }
  if (parseVersion(options.version) === null) errors.push(`version is not valid SemVer: ${options.version}`);
  if (manifest.private === true) errors.push("package is private");
  if (!repositoryFields(manifest, options.package)) {
    errors.push("repository/publishConfig metadata does not match Astack trusted publishing");
  }

  const gitState = globalGitState();
  if (!gitState.headCommit || gitState.headCommit.toLowerCase() !== options.commit.toLowerCase()) {
    errors.push(`checked-out commit is ${gitState.headCommit ?? "unknown"}, expected ${options.commit}`);
  }
  if (gitState.error) errors.push(gitState.error);
  const dirtyPaths = gitState.dirtyPaths.filter((path) => inside(path, `packages/${options.package}`));
  if (dirtyPaths.length > 0) errors.push(`dirty package paths: ${dirtyPaths.join(", ")}`);

  const registry = npmView(manifest.name, options.registry);
  if (!registry.ok) {
    errors.push(registry.error);
  } else if (!registry.unpublished) {
    if (registry.versions.includes(options.version)) {
      errors.push(`version is already published: ${manifest.name}@${options.version}`);
    }
    const ahead = registry.versions.some((version) => {
      const comparison = compareVersions(version, options.version);
      return comparison !== null && comparison > 0;
    });
    if (ahead) errors.push("registry contains a version newer than the requested version");
  }

  let pack = null;
  const packCap = packCapability(options);
  if (!options.noPack) {
    if (!packCap.ok) {
      pack = { ok: false, state: "unsupported", error: packCap.error };
      errors.push(packCap.error);
    } else {
      pack = packDryRun(options.package);
      if (!pack.ok) errors.push(pack.error);
      else if (pack.name !== manifest.name || pack.version !== manifest.version) {
        errors.push(`pack identity ${pack.name}@${pack.version} does not match ${manifest.name}@${manifest.version}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    package: options.package,
    name: manifest.name,
    version: options.version,
    commit: options.commit,
    headCommit: gitState.headCommit,
    repository: options.registry ?? "npm default",
    packCapability: packCap,
    dirtyPaths,
    registry,
    pack,
    errors,
  };
}

function printTable(report) {
  const columns = [
    [
      "PACKAGE",
      "LOCAL",
      "NPM LATEST",
      "REMOTE VER",
      "REMOTE/NPM",
      "STATE",
      "TAG",
      "DIRTY",
      "PACK",
      "PUBLISHABLE",
      "BLOCKERS",
    ],
    ...report.packages.map((entry) => [
      entry.package,
      entry.version ?? "-",
      entry.registry ?? "-",
      entry.remote?.version ?? "-",
      entry.remote?.state ?? "-",
      entry.state,
      entry.tagStatus ?? "-",
      String(entry.dirtyPaths?.length ?? 0),
      entry.pack ? (entry.pack.ok ? "ok" : "failed") : "skipped",
      entry.publishable ? "yes" : "no",
      entry.blockers?.join(",") || "-",
    ]),
  ];
  const widths = columns[0].map((_, index) => Math.max(...columns.map((row) => row[index].length)));
  for (const row of columns) {
    console.log(row.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd());
  }
  const summary = report.summary;
  console.log(
    `\n${summary.packages} package(s): ${summary.publishable} publishable, ${summary.blocked} blocked, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.remoteChecked} remote checked, ${summary.remoteUnavailable} remote unavailable, ${summary.remoteFailed} remote failed`,
  );
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}\n\n${usage}`);
    process.exit(2);
  }

  if (options.help) {
    console.log(usage);
    return;
  }

  try {
    if (options.verifyTarget) {
      const result = verifyTarget(options);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
      return;
    }

    const report = await makeReport(options);
    if (options.format === "json") console.log(JSON.stringify(report, null, 2));
    else printTable(report);

    const actualErrors = report.packages.some((entry) => entry.state === "check-failed");
    const remoteUnavailable = report.packages.some((entry) =>
      ["unavailable", "check-failed"].includes(entry.remote?.state),
    );
    const strictBlockers =
      options.strict && (report.packages.some((entry) => entry.blockers?.length > 0) || remoteUnavailable);
    if (actualErrors || strictBlockers) process.exit(1);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(2);
  }
}

main();
