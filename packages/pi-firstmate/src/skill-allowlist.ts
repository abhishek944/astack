/**
 * Exact-name filtering for First Mate's model-facing skill advertisement.
 *
 * Pi discovers skills from user, project, package and explicit locations, then
 * advertises each discovered skill's name, description and path in the system
 * prompt. This module only narrows that per-run advertisement for the
 * `pi-firstmate.coordinatorSkills` setting. It never loads, unloads, reorders or
 * mutates skills, and Pi keeps its own complete list for `/skill:<name>`
 * expansion, so explicit skill commands and already loaded instructions are
 * unaffected.
 */

export interface NamedSkill {
	name: string;
}

export interface SkillAllowlistResult<T extends NamedSkill> {
	/** Skills that stay advertised, in Pi's discovery order. */
	skills: T[];
	/** Configured names no discovered skill provides, in configured order. */
	unknown: string[];
}

/**
 * Apply exact names to a discovered skill list. Matching is exact (no globs,
 * case folding or whitespace trimming), and neither input is mutated.
 */
export function applySkillAllowlist<T extends NamedSkill>(
	skills: readonly T[],
	names: readonly string[],
): SkillAllowlistResult<T> {
	const allowed = new Set(names);
	const advertised: T[] = [];
	const discovered = new Set<string>();

	for (const skill of skills) {
		discovered.add(skill.name);
		if (allowed.has(skill.name)) advertised.push(skill);
	}

	const unknown: string[] = [];
	const reported = new Set<string>();
	for (const name of names) {
		if (discovered.has(name) || reported.has(name)) continue;
		reported.add(name);
		unknown.push(name);
	}

	return { skills: advertised, unknown };
}
