/**
 * The routing policy as it is stored in the `model-routing-policy` skill.
 *
 * One ```json block in the skill's Markdown body holds the policy. Nothing else
 * in the file is ours: the frontmatter, the title and the surrounding prose are
 * carried through a save untouched. The block keeps the table's order, its
 * model / when / thinking / fast values, and the guidance below the old table
 * verbatim as `notes` — this module never rewrites prose or invents precedence.
 */

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const FAST_MODES = ["on", "off"] as const;
export type FastMode = (typeof FAST_MODES)[number];

export const POLICY_LANGUAGE = "json";

/** One row of the policy: who does the work, and with which model settings. */
export interface RoutingRule {
  model: string;
  when: string;
  thinking: ThinkingLevel;
  /** Absent when the stored rule leaves Fast to its own guidance. */
  fast?: FastMode;
}

export interface RoutingPolicy {
  rules: RoutingRule[];
  notes: string[];
}

export interface PolicyBlock {
  /** Offsets of the fenced block, fences included. */
  start: number;
  end: number;
}

export type PolicyParse =
  | { ok: true; policy: RoutingPolicy; block: PolicyBlock }
  | { ok: false; error: string };

const FENCE = /^```([^\n`]*)\n([\s\S]*?)^```[^\n]*$/gm;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every fenced block whose language is json, with its offsets and body. */
function jsonBlocks(markdown: string): { block: PolicyBlock; body: string }[] {
  const found: { block: PolicyBlock; body: string }[] = [];
  FENCE.lastIndex = 0;
  for (let match = FENCE.exec(markdown); match !== null; match = FENCE.exec(markdown)) {
    const language = (match[1] ?? "").trim().toLowerCase();
    if (language !== POLICY_LANGUAGE) continue;
    found.push({ block: { start: match.index, end: match.index + match[0].length }, body: match[2] ?? "" });
  }
  return found;
}

/** Reads the policy out of a skill body, or says exactly what to fix. */
export function parsePolicyBody(markdown: string): PolicyParse {
  let problem = "No ```json policy block was found in the skill.";
  for (const candidate of jsonBlocks(markdown)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.body);
    } catch (error) {
      problem = `The skill's \`\`\`json block is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.rules)) {
      problem = "The skill's ```json block has no rules list.";
      continue;
    }
    const policy = validatePolicy(parsed);
    if ("error" in policy) {
      problem = policy.error;
      continue;
    }
    return { ok: true, policy: policy.policy, block: candidate.block };
  }
  return { ok: false, error: problem };
}

export type PolicyValidation = { policy: RoutingPolicy } | { error: string };

/**
 * Accepts exactly the stored shape. Unknown fields are refused rather than
 * dropped, so a hand edit is never silently rewritten.
 */
export function validatePolicy(value: unknown): PolicyValidation {
  if (!isRecord(value)) return { error: "The policy must be a JSON object." };
  const unknownRoot = Object.keys(value).filter((key) => key !== "rules" && key !== "notes");
  if (unknownRoot.length > 0) {
    return { error: `The policy has unsupported fields: ${unknownRoot.join(", ")}. Edit the skill directly to keep them.` };
  }
  if (!Array.isArray(value.rules)) return { error: "The policy needs a rules list." };
  const rules: RoutingRule[] = [];
  for (const [index, entry] of value.rules.entries()) {
    const where = `Rule ${index + 1}`;
    if (!isRecord(entry)) return { error: `${where} must be an object.` };
    const unknown = Object.keys(entry).filter((key) => !["model", "when", "thinking", "fast"].includes(key));
    if (unknown.length > 0) {
      return { error: `${where} has unsupported fields: ${unknown.join(", ")}. Edit the skill directly to keep them.` };
    }
    const model = typeof entry.model === "string" ? entry.model.trim() : "";
    if (!model) return { error: `${where} needs a model.` };
    if (/\s/.test(model)) return { error: `${where} has a model with spaces. Use provider/model.` };
    const when = typeof entry.when === "string" ? entry.when.trim() : "";
    if (!when) return { error: `${where} needs a "when" description.` };
    const thinking = entry.thinking;
    if (typeof thinking !== "string" || !(THINKING_LEVELS as readonly string[]).includes(thinking)) {
      return { error: `${where} has thinking "${String(thinking)}"; use one of ${THINKING_LEVELS.join(", ")}.` };
    }
    const fast = entry.fast;
    if (fast !== undefined && (typeof fast !== "string" || !(FAST_MODES as readonly string[]).includes(fast))) {
      return { error: `${where} has fast "${String(fast)}"; use on or off.` };
    }
    rules.push({
      model,
      when,
      thinking: thinking as ThinkingLevel,
      ...(typeof fast === "string" ? { fast: fast as FastMode } : {}),
    });
  }
  const notes: string[] = [];
  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes) || value.notes.some((note) => typeof note !== "string")) {
      return { error: "notes must be a list of text lines." };
    }
    notes.push(...value.notes.map((note) => (note as string).trim()).filter((note) => note.length > 0));
  }
  return { policy: { rules, notes } };
}

/** The exact block body: stable field order, two-space indent, one trailing newline. */
export function serializePolicy(policy: RoutingPolicy): string {
  const ordered = {
    rules: policy.rules.map((rule) => ({
      model: rule.model,
      when: rule.when,
      thinking: rule.thinking,
      ...(rule.fast === undefined ? {} : { fast: rule.fast }),
    })),
    notes: policy.notes,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** The whole skill body with only the policy block replaced. */
export function replacePolicyBody(markdown: string, block: PolicyBlock, policy: RoutingPolicy): string {
  const fence = `\`\`\`${POLICY_LANGUAGE}\n${serializePolicy(policy)}\`\`\``;
  return `${markdown.slice(0, block.start)}${fence}${markdown.slice(block.end)}`;
}

/** A new rule starts the way every stored rule is: fast off. */
export function emptyRule(): RoutingRule {
  return { model: "", when: "", thinking: "medium", fast: "off" };
}
