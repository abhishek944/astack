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
/**
 * Apply exact names to a discovered skill list. Matching is exact (no globs,
 * case folding or whitespace trimming), and neither input is mutated.
 */
export function applySkillAllowlist(skills, names) {
    const allowed = new Set(names);
    const advertised = [];
    const discovered = new Set();
    for (const skill of skills) {
        discovered.add(skill.name);
        if (allowed.has(skill.name))
            advertised.push(skill);
    }
    const unknown = [];
    const reported = new Set();
    for (const name of names) {
        if (discovered.has(name) || reported.has(name))
            continue;
        reported.add(name);
        unknown.push(name);
    }
    return { skills: advertised, unknown };
}
