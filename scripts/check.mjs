#!/usr/bin/env node
// Astack workspace check.
//
// Each package and service is independent: no npm workspaces, no hoisting, no
// shared lockfile. This script only runs each directory's own lifecycle.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const install = args.has("--install");
const skillsOnly = args.has("--skills");

const results = [];
let failures = 0;

function run(cwd, args, { capture = false } = {}) {
  const out = spawnSync("npm", args, {
    cwd,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: process.env,
  });
  return { status: out.status ?? 1, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function record(label, ok, detail = "") {
  results.push({ label, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function installDeps(dir) {
  const hasLock = existsSync(join(dir, "package-lock.json"));
  const args = hasLock ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-package-lock", "--no-audit", "--no-fund"];
  console.log(`\n### ${dir.slice(root.length + 1)}: npm ${args.join(" ")}`);
  return run(dir, args);
}

function checkDirectory(dir, kind) {
  const rel = dir.slice(root.length + 1);
  const manifest = readJson(join(dir, "package.json"));
  console.log(`\n### ${rel} (${manifest.name}@${manifest.version}, ${kind})`);

  if (install && installDeps(dir).status !== 0) {
    record(`${rel} install`, false);
    return;
  }

  for (const script of ["typecheck", "build"]) {
    if (!manifest.scripts?.[script]) {
      console.log(`skip  ${rel} ${script} (not defined)`);
      continue;
    }
    const { status } = run(dir, ["run", "--silent", script]);
    if (status !== 0) {
      record(`${rel} ${script}`, false);
      return;
    }
    record(`${rel} ${script}`, true);
  }

  if (kind !== "package") return;

  const packed = run(dir, ["pack", "--dry-run", "--json"], { capture: true });
  if (packed.status !== 0) {
    console.log(packed.stderr || packed.stdout);
    record(`${rel} pack`, false);
    return;
  }
  let detail;
  try {
    const [info] = JSON.parse(packed.stdout.slice(packed.stdout.indexOf("[")));
    const identityOk = info.name === manifest.name && info.version === manifest.version;
    record(
      `${rel} pack`,
      identityOk && info.entryCount > 0,
      `${info.name}@${info.version}, ${info.entryCount} files, ${Math.round(info.size / 1024)} KiB`,
    );
  } catch {
    record(`${rel} pack`, false, "unparseable npm pack output");
  }
}

function checkSkills() {
  const script = join(root, "skills/pi-herdr-skills/scripts/check-repo.sh");
  if (!existsSync(script)) {
    record("skills global sync", false, "check-repo.sh missing");
    return;
  }
  console.log("\n### skills/pi-herdr-skills: global synchronization");
  const out = spawnSync("bash", [script], { stdio: "inherit", env: process.env });
  record("skills global sync", out.status === 0);
}

if (!skillsOnly) {
  for (const dir of readdirSync(join(root, "packages")).sort()) {
    const abs = join(root, "packages", dir);
    if (existsSync(join(abs, "package.json"))) checkDirectory(abs, "package");
  }
  for (const dir of readdirSync(join(root, "services")).sort()) {
    const abs = join(root, "services", dir);
    if (existsSync(join(abs, "package.json"))) checkDirectory(abs, "service");
  }
}

if (skillsOnly || args.has("--all")) checkSkills();

const passed = results.length - failures;
console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${passed}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
