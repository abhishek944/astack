/**
 * First Mate - configurable coordinator mode for primary Pi sessions.
 *
 * The mode keeps conversation, decisions and quick inspection in the main
 * session, and delegates project execution to workers through an available
 * installed orchestration backend. The behavioral policy lives in
 * `skills/firstmate/SKILL.md`; this extension only owns configuration, the
 * session toggle, worker suppression, status and per-run prompt guidance.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function firstMateExtension(pi: ExtensionAPI): void;
