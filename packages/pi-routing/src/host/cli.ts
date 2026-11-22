/**
 * `pi-routing` — the host half of the Routing panel.
 *
 * The panel cannot write outside the Herdr app home, so it hands drafts to this
 * command: a snapshot of Pi's models and the policy skill, a compare-and-swap
 * save of Pi's settings, and a save of the current policy skill. Every reply is
 * one JSON object; nothing here starts Pi,
 * a session or an agent.
 */
import { readFile } from "node:fs/promises";
import { type RoutingPolicy, validatePolicy } from "../core/policy.js";
import { installRouting } from "./install.js";
import { readModels } from "./models.js";
import { type HostEnv, hostEnv, settingsPath } from "./paths.js";
import { readPolicy, writePolicy } from "./policy.js";
import { writeEnabledModels } from "./settings.js";

const USAGE = `pi-routing — Herdr's Routing panel host

Usage
  pi-routing snapshot [--json]
  pi-routing save-models --draft <file> --expect <sha256|none> [--json]
  pi-routing save-policy --draft <file> [--json]
  pi-routing install [--layout <name>] [--force] [--skip-check]

A draft file holds {"patterns": [...]} for the models save and
{"rules": [...], "notes": [...]} for the policy save. Settings saves are refused
when the file no longer matches the sha256 the panel read; policy saves apply
the rules to the current skill file.
`;

interface Parsed {
  command: string;
  flags: Map<string, string | true>;
}

export function parseArgs(argv: readonly string[]): Parsed {
  const flags = new Map<string, string | true>();
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(name, next);
        index += 1;
      } else flags.set(name, true);
      continue;
    }
    if (!command) command = arg;
  }
  return { command, flags };
}

function flagText(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One JSON object on stdout, whatever happened. */
function reply(value: unknown): number {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  return isRecord(value) && value.ok === false ? 1 : 0;
}

/** A draft the panel wrote inside the app home, or a readable refusal. */
async function readDraft(path: string | undefined): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  if (!path) return { ok: false, error: "No --draft file was given." };
  try {
    return { ok: true, value: JSON.parse(await readFile(path, "utf8")) };
  } catch {
    return { ok: false, error: "The draft could not be read. Nothing was written." };
  }
}

function readExpect(value: string | undefined, allowNone: boolean): { ok: true; hash: string | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: false, error: "No --expect hash was given." };
  if (allowNone && value === "none") return { ok: true, hash: null };
  if (!/^[a-f0-9]{64}$/.test(value)) return { ok: false, error: "The --expect value is not a sha256 hash." };
  return { ok: true, hash: value };
}

function patternsDraft(value: unknown): { ok: true; patterns: string[] } | { ok: false; error: string } {
  if (!isRecord(value) || !Array.isArray(value.patterns)) return { ok: false, error: "The draft has no patterns list." };
  const patterns: string[] = [];
  for (const entry of value.patterns) {
    if (typeof entry !== "string" || !entry.trim()) return { ok: false, error: "Every enabled-models entry must be text." };
    if (/\s/.test(entry.trim())) return { ok: false, error: `"${entry.trim()}" has spaces; model entries cannot.` };
    patterns.push(entry.trim());
  }
  return { ok: true, patterns };
}

function policyDraft(value: unknown): { ok: true; policy: RoutingPolicy } | { ok: false; error: string } {
  const validated = validatePolicy(value);
  return "error" in validated ? { ok: false, error: validated.error } : { ok: true, policy: validated.policy };
}

async function snapshot(env: HostEnv): Promise<unknown> {
  const [models, policy] = await Promise.all([readModels(env), readPolicy(env)]);
  return {
    models: models.ok
      ? { ok: true, available: models.available, selection: models.selection }
      : { ok: false, error: models.error },
    policy: policy.ok
      ? { ok: true, path: policy.path, hash: policy.hash, rules: policy.policy.rules, notes: policy.policy.notes }
      : { ok: false, path: policy.path, error: policy.error },
    settingsPath: settingsPath(env),
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const env = hostEnv();
  const parsed = parseArgs(argv);
  switch (parsed.command) {
    case "":
      process.stdout.write(USAGE);
      return 0;
    case "snapshot":
      return reply(await snapshot(env));
    case "save-models": {
      const draft = await readDraft(flagText(parsed, "draft"));
      if (!draft.ok) return reply({ ok: false, error: draft.error });
      const patterns = patternsDraft(draft.value);
      if (!patterns.ok) return reply({ ok: false, error: patterns.error });
      const expect = readExpect(flagText(parsed, "expect"), true);
      if (!expect.ok) return reply({ ok: false, error: expect.error });
      const saved = await writeEnabledModels(env, patterns.patterns, expect.hash);
      if (!saved.ok) return reply({ ok: false, error: saved.error });
      return reply({ ok: true, path: saved.path, hash: saved.hash, count: patterns.patterns.length });
    }
    case "save-policy": {
      const draft = await readDraft(flagText(parsed, "draft"));
      if (!draft.ok) return reply({ ok: false, error: draft.error });
      const policy = policyDraft(draft.value);
      if (!policy.ok) return reply({ ok: false, error: policy.error });
      const saved = await writePolicy(env, policy.policy);
      if (!saved.ok) return reply({ ok: false, error: saved.error });
      return reply({ ok: true, path: saved.path, hash: saved.hash, count: policy.policy.rules.length });
    }
    case "install": {
      const layout = flagText(parsed, "layout");
      const report = await installRouting({
        ...env,
        ...(layout ? { layout } : {}),
        force: parsed.flags.has("force"),
        skipCheck: parsed.flags.has("skip-check"),
      });
      process.stdout.write(`${JSON.stringify(report)}\n`);
      if (report.check.ran && !report.check.ok) {
        process.stderr.write(`${report.check.output}\n`);
        return 1;
      }
      return 0;
    }
    default:
      process.stderr.write(`Unknown command "${parsed.command}".\n\n${USAGE}`);
      return 1;
  }
}
