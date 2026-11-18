/**
 * The `default` rule in the `model-routing-policy` skill: the model and thinking
 * level the usage fallback switches to when the current model's plan usage is
 * exhausted.
 *
 * The skill is found where Pi finds it — the agent directory first, then an
 * installed package that ships it, then the shared skills directory — and only
 * the ```json policy block is read. Frontmatter and prose are left alone, and
 * this module never writes the file: pi-routing stays the only writer.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const POLICY_SKILL = "model-routing-policy";

/** A responsibility rule describes prose; only the fallback uses this word. */
export const DEFAULT_RULE_WHEN = "default";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** The thinking levels `pi.setThinkingLevel()` accepts; Pi clamps them to the model. */
export type PolicyThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface DefaultRule {
  /** `provider/model`, as stored in the policy. */
  readonly model: string;
  readonly provider: string;
  readonly modelId: string;
  readonly thinking: PolicyThinkingLevel;
}

export type DefaultRuleRead =
  | { readonly ok: true; readonly path: string; readonly rule: DefaultRule }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThinkingLevel(value: unknown): value is PolicyThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

/** Pi's agent directory: `PI_CODING_AGENT_DIR` when set, else `~/.pi/agent`. */
function agentDirectory(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  return configured.startsWith("~") ? join(homedir(), configured.slice(1)) : configured;
}

/** Installed Pi packages, as `settings.json` lists them; npm and git entries carry no path. */
async function packageDirectories(agentDir: string): Promise<string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.packages)) return [];
  const directories: string[] = [];
  for (const entry of parsed.packages) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    if (!value || value.startsWith("npm:") || value.startsWith("git:")) continue;
    if (value.startsWith("~")) {
      directories.push(join(homedir(), value.slice(1)));
      continue;
    }
    directories.push(isAbsolute(value) ? value : resolve(agentDir, value));
  }
  return directories;
}

/** Every place the routing skill can live, most specific first. */
async function policyPath(agentDir: string): Promise<string | null> {
  const candidates = [join(agentDir, "skills", POLICY_SKILL, "SKILL.md")];
  for (const directory of await packageDirectories(agentDir)) {
    candidates.push(join(directory, "skills", POLICY_SKILL, "SKILL.md"));
  }
  candidates.push(join(homedir(), ".agents", "skills", POLICY_SKILL, "SKILL.md"));
  for (const path of candidates) {
    try {
      const text = await readFile(path, "utf8");
      if (text.includes("name:")) return path;
    } catch {
      // Try the next place Pi could be loading the skill from.
    }
  }
  return null;
}

/** Every fenced block whose language is json. */
function jsonBlocks(markdown: string): string[] {
  const fence = /^```([^\n`]*)\n([\s\S]*?)^```[^\n]*$/gm;
  const bodies: string[] = [];
  for (let match = fence.exec(markdown); match !== null; match = fence.exec(markdown)) {
    const language = (match[1] ?? "").trim().toLowerCase();
    if (language === "json") bodies.push(match[2] ?? "");
  }
  return bodies;
}

/** The stored rule whose `when` is exactly `default`, or why it cannot be used. */
function defaultRule(rules: readonly unknown[]): { rule: DefaultRule } | { error: string } {
  for (const entry of rules) {
    if (!isRecord(entry)) continue;
    const when = entry.when;
    if (typeof when !== "string" || when.trim() !== DEFAULT_RULE_WHEN) continue;
    const model = typeof entry.model === "string" ? entry.model.trim() : "";
    if (!model) return { error: "The default rule has no model." };
    if (/\s/.test(model)) return { error: `The default rule model "${model}" contains spaces; use provider/model.` };
    const separator = model.indexOf("/");
    if (separator <= 0 || separator === model.length - 1) {
      return { error: `The default rule model "${model}" is not provider/model.` };
    }
    const thinking = entry.thinking;
    if (!isThinkingLevel(thinking)) {
      return {
        error: `The default rule has thinking "${String(thinking)}"; use one of ${THINKING_LEVELS.join(", ")}.`,
      };
    }
    return {
      rule: {
        model,
        provider: model.slice(0, separator),
        modelId: model.slice(separator + 1),
        thinking,
      },
    };
  }
  return { error: `The skill's policy has no rule whose when is exactly ${DEFAULT_RULE_WHEN}.` };
}

/** The policy's default rule, read from the first json block that has one. */
function readPolicy(markdown: string): { rule: DefaultRule } | { error: string } {
  let problem = "No ```json policy block was found in the skill.";
  for (const body of jsonBlocks(markdown)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      problem = `The skill's \`\`\`json block is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.rules)) {
      problem = "The skill's ```json block has no rules list.";
      continue;
    }
    const parsedRule = defaultRule(parsed.rules);
    if ("error" in parsedRule) {
      problem = parsedRule.error;
      continue;
    }
    return parsedRule;
  }
  return { error: problem };
}

export async function readDefaultRule(): Promise<DefaultRuleRead> {
  const agentDir = agentDirectory();
  const path = await policyPath(agentDir);
  if (!path) {
    return {
      ok: false,
      error: `No ${POLICY_SKILL} skill was found under ${agentDir}, its package entries, or ~/.agents/skills.`,
    };
  }
  let markdown: string;
  try {
    markdown = await readFile(path, "utf8");
  } catch {
    return { ok: false, error: `Cannot read ${path}.` };
  }
  const parsed = readPolicy(markdown);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  return { ok: true, path, rule: parsed.rule };
}
