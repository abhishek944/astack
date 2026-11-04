#!/usr/bin/env node
// Structured config merge for Astack setup.
//
//   configure.mjs packages --agent-dir DIR --stamp STAMP --summary-file FILE [--keep-package-paths] PATH...
//   configure.mjs mcp --agent-dir DIR --stamp STAMP --summary-file FILE --name NAME --command CMD [--arg A]...
//
// Only the `packages` array and the named MCP server are changed. Every write is
// backed up first and written atomically. Unrelated keys/servers never reach output.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync, realpathSync, renameSync } from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
import { homedir } from "node:os";

function fail(message) {
  process.stderr.write(`configure: ${message}\n`);
  process.exit(1);
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`invalid JSON in ${path}: ${error.message}`);
  }
}

function real(path) {
  try {
    return resolve(path);
  } catch {
    return path;
  }
}

function canonical(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return real(path);
  }
}

function packageManifest(dir) {
  const manifest = readJson(join(dir, "package.json"), null);
  if (!manifest || typeof manifest.name !== "string") return null;
  return manifest;
}

function npmName(source) {
  const spec = source.slice("npm:".length);
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash === -1) return spec;
    const at = spec.indexOf("@", slash + 1);
    return at === -1 ? spec : spec.slice(0, at);
  }
  const at = spec.indexOf("@");
  return at === -1 ? spec : spec.slice(0, at);
}

function gitInstallDir(source, agentDir) {
  let rest = source.replace(/^git:/, "").replace(/^https?:\/\//, "");
  // git:github.com/owner/repo[@ref]
  const lastSlash = rest.lastIndexOf("/");
  const tail = rest.slice(lastSlash + 1);
  const at = tail.lastIndexOf("@");
  if (at > 0) rest = rest.slice(0, lastSlash + 1) + tail.slice(0, at);
  rest = rest.replace(/\.git$/, "");
  // ssh scp syntax is not reconstructed; fall back to the basename below.
  if (rest.includes(":")) rest = rest.replace(/^[^/]*:/, "");
  const candidate = join(agentDir, "git", rest);
  if (existsSync(join(candidate, "package.json"))) return candidate;
  const name = basename(rest);
  return name ? `name:${name}` : null;
}

function sourceOf(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.source === "string") return entry.source;
  return null;
}

function resolveEntry(entry, agentDir) {
  const source = sourceOf(entry);
  if (!source) return { source: null, name: null, path: null };
  if (source.startsWith("npm:")) {
    return { source, name: npmName(source), path: null };
  }
  if (source.startsWith("git:") || /^https?:\/\//.test(source)) {
    const found = gitInstallDir(source, agentDir);
    if (found && found.startsWith("name:")) {
      return { source, name: found.slice("name:".length), path: null };
    }
    if (found) {
      const manifest = packageManifest(found);
      return { source, name: manifest?.name ?? basename(found), path: found };
    }
    return { source, name: null, path: null };
  }
  let local = source;
  if (local.startsWith("~/")) local = join(homedir(), local.slice(2));
  else if (!local.startsWith("/")) local = resolve(agentDir, local);
  const manifest = packageManifest(local);
  return { source, name: manifest?.name ?? null, path: local };
}

function parseArgs(argv) {
  const options = { args: [], paths: [] };
  const takesValue = new Set(["--agent-dir", "--stamp", "--summary-file", "--name", "--command", "--arg"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--keep-package-paths" || arg === "--dry-run") {
      options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
      continue;
    }
    if (takesValue.has(arg)) {
      if (i + 1 >= argv.length) fail(`${arg} needs a value`);
      const value = argv[i + 1];
      i += 1;
      if (arg === "--arg") options.args.push(value);
      else if (arg === "--agent-dir") options.agentDir = value;
      else if (arg === "--stamp") options.stamp = value;
      else if (arg === "--summary-file") options.summaryFile = value;
      else if (arg === "--name") options.name = value;
      else if (arg === "--command") options.command = value;
      continue;
    }
    if (arg.startsWith("--")) fail(`unknown option: ${arg}`);
    options.paths.push(arg);
  }
  return options;
}

function requireCommon(options) {
  if (!options.agentDir) fail("--agent-dir is required");
  if (!options.stamp) fail("--stamp is required");
  if (!options.summaryFile) fail("--summary-file is required");
  mkdirSync(options.agentDir, { recursive: true });
  mkdirSync(dirname(options.summaryFile), { recursive: true });
}

function backupFile(path, agentDir, stamp) {
  const backupDir = join(agentDir, "backups", `astack-setup-${stamp}`);
  const target = join(backupDir, basename(path));
  if (existsSync(target)) return target;
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(path, target);
  return target;
}

function writeJsonAtomic(path, value, mode) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(tmp, path);
}

function writeSummary(file, lines) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function entryMetadataKey(entry) {
  if (!isPlainObject(entry)) return null;
  const { source, ...metadata } = entry;
  return JSON.stringify(metadata);
}

function mergePackages(options) {
  const settingsPath = join(options.agentDir, "settings.json");
  const settings = readJson(settingsPath, {});
  if (settings.packages !== undefined && !Array.isArray(settings.packages)) {
    fail(`${settingsPath} has a non-array packages value; refusing to modify it`);
  }
  const targets = new Map();
  for (const path of options.paths) {
    const abs = canonical(path);
    if (!existsSync(join(abs, "package.json"))) fail(`missing package.json in ${abs}`);
    const manifest = packageManifest(abs);
    if (!manifest) fail(`cannot read package name in ${abs}`);
    targets.set(manifest.name, { name: manifest.name, path: abs, short: basename(abs) });
  }
  const entries = Array.isArray(settings.packages) ? settings.packages.slice() : [];
  const records = [];
  for (const entry of entries) {
    const resolved = resolveEntry(entry, options.agentDir);
    let target = resolved.name ? targets.get(resolved.name) : null;
    if (!target && resolved.name) {
      for (const candidate of targets.values()) {
        if (candidate.short === resolved.name) {
          target = candidate;
          break;
        }
      }
    }
    // A relative entry copied into another agent directory resolves elsewhere.
    // Match a stale package path by its trailing package directory name.
    if (!target && resolved.path && !existsSync(resolved.path) && resolved.source) {
      const normalized = resolved.source.replace(/\/+$/, "");
      for (const candidate of targets.values()) {
        if (normalized.endsWith(`/packages/${candidate.short}`) || normalized.endsWith(`/${candidate.short}`)) {
          target = candidate;
          break;
        }
      }
    }
    const samePath = Boolean(target && resolved.path && canonical(resolved.path) === target.path);
    records.push({ entry, resolved, target, samePath });
  }

  const groups = new Map();
  for (const record of records) {
    if (!record.target) continue;
    const list = groups.get(record.target.name) ?? [];
    list.push(record);
    groups.set(record.target.name, list);
  }

  const decisions = new Map();
  for (const target of targets.values()) {
    const items = groups.get(target.name) ?? [];
    if (items.length === 0) {
      decisions.set(target.name, { mode: "add" });
      continue;
    }
    if (options.keepPackagePaths) {
      decisions.set(target.name, { mode: "keepAll" });
      continue;
    }
    const same = items.filter((item) => item.samePath);
    if (same.length > 0) {
      const canonicalEntry = same[0].entry;
      const canonicalMeta = entryMetadataKey(canonicalEntry);
      const drop = [...same.slice(1), ...items.filter((item) => !item.samePath)];
      const coalescible = drop.every((item) => {
        const meta = entryMetadataKey(item.entry);
        return meta === null || (canonicalMeta !== null && meta === canonicalMeta);
      });
      if (!coalescible) {
        decisions.set(target.name, { mode: "keepAll" });
        continue;
      }
      decisions.set(target.name, { mode: "same", canonical: canonicalEntry, drop });
      continue;
    }
    const objects = items.filter((item) => isPlainObject(item.entry));
    if (objects.length > 1) {
      const firstMeta = entryMetadataKey(objects[0].entry);
      const identical = objects.every((item) => entryMetadataKey(item.entry) === firstMeta);
      if (firstMeta === null || !identical) {
        // Distinct filtered entries cannot be merged without guessing which
        // resources the user intended. Leave them and report a manual conflict.
        decisions.set(target.name, { mode: "keepAll" });
        continue;
      }
    }
    const canonical = objects.length > 0 ? { ...objects[0].entry, source: target.path } : target.path;
    decisions.set(target.name, { mode: "replace", canonical, drop: items });
  }

  const kept = [];
  const emitted = new Set();
  const added = [];
  const replaced = [];
  const coalesced = [];
  const conflicts = [];
  for (const record of records) {
    if (!record.target) {
      kept.push(record.entry);
      continue;
    }
    const decision = decisions.get(record.target.name);
    if (decision.mode === "keepAll") {
      kept.push(record.entry);
      continue;
    }
    if (emitted.has(record.target.name)) continue;
    kept.push(decision.canonical);
    emitted.add(record.target.name);
  }
  for (const target of targets.values()) {
    const decision = decisions.get(target.name);
    if (decision.mode === "add") {
      kept.push(target.path);
      added.push(target.name);
    } else if (decision.mode === "keepAll") {
      conflicts.push(target.name);
    } else if (decision.mode === "replace") {
      for (const item of decision.drop) {
        replaced.push({ name: target.name, from: item.resolved.source });
      }
    } else if (decision.mode === "same" && decision.drop.length > 0) {
      for (const item of decision.drop) {
        coalesced.push({ name: target.name, from: item.resolved.source });
      }
    }
  }
  const changed = added.length > 0 || replaced.length > 0 || coalesced.length > 0;
  let backup = "";
  if (changed && !options.dryRun) {
    if (existsSync(settingsPath)) backup = backupFile(settingsPath, options.agentDir, options.stamp);
    const mode = existsSync(settingsPath) ? statSync(settingsPath).mode & 0o777 : 0o600;
    settings.packages = kept;
    writeJsonAtomic(settingsPath, settings, mode);
  }
  writeSummary(options.summaryFile, [
    `changed=${changed ? 1 : 0}`,
    `added=${added.length}`,
    `replaced=${replaced.length}`,
    `coalesced=${coalesced.length}`,
    `kept=${kept.length - added.length}`,
    `conflicts=${conflicts.length}`,
    `backup=${backup}`,
    `settings=${settingsPath}`,
  ]);
  process.stdout.write(
    `packages changed=${changed ? 1 : 0} added=${added.length} replaced=${replaced.length} coalesced=${coalesced.length} conflicts=${conflicts.length}\n`,
  );
  for (const item of replaced) process.stdout.write(`  replaced ${item.name}: ${item.from}\n`);
  for (const item of coalesced) process.stdout.write(`  coalesced ${item.name}: ${item.from}\n`);
  for (const name of conflicts) process.stdout.write(`  kept conflicting/filtered entries for ${name}\n`);
}

function mergeMcp(options) {
  if (!options.name) fail("--name is required");
  if (!options.command) fail("--command is required");
  const mcpPath = join(options.agentDir, "mcp.json");
  const config = readJson(mcpPath, { mcpServers: {} });
  if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
    fail(`${mcpPath} has no mcpServers object; refusing to modify it`);
  }
  const desired = {
    command: options.command,
    args: options.args,
    exposure: "codemode",
    description:
      "Local Cua Driver: inspect and control desktop apps. Prefer accessibility elements, verify actions with fresh snapshots, and ask before sensitive or destructive work.",
  };
  const existing = config.mcpServers[options.name];
  let changed = false;
  let conflict = false;
  if (existing) {
    const sameCommand = canonical(String(existing.command || "")) === canonical(options.command);
    const sameArgs = JSON.stringify(existing.args || []) === JSON.stringify(options.args);
    const sameExposure = (existing.exposure || "codemode") === "codemode";
    if (sameCommand && sameArgs && sameExposure) {
      conflict = false;
    } else {
      conflict = true;
    }
  } else {
    config.mcpServers[options.name] = desired;
    changed = true;
  }
  let backup = "";
  if (changed && !options.dryRun) {
    if (existsSync(mcpPath)) backup = backupFile(mcpPath, options.agentDir, options.stamp);
    const mode = existsSync(mcpPath) ? statSync(mcpPath).mode & 0o777 : 0o600;
    writeJsonAtomic(mcpPath, config, mode);
  }
  writeSummary(options.summaryFile, [
    `changed=${changed ? 1 : 0}`,
    `conflicts=${conflict ? 1 : 0}`,
    `backup=${backup}`,
    `mcp=${mcpPath}`,
    `server=${options.name}`,
  ]);
  process.stdout.write(
    `mcp changed=${changed ? 1 : 0} conflicts=${conflict ? 1 : 0} server=${options.name}\n`,
  );
}

const [command, ...rest] = process.argv.slice(2);
const options = parseArgs(rest);
requireCommon(options);
if (command === "packages") mergePackages(options);
else if (command === "mcp") mergeMcp(options);
else fail("usage: configure.mjs packages|mcp ...");
