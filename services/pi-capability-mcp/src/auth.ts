import { createHash } from "node:crypto";
import type { Principal } from "./config.js";

/** Resolve a bearer token to its configured principal without ever logging the token. */
export function authenticate(
  authorization: string | undefined,
  tokens: ReadonlyMap<string, Principal>,
): Principal | undefined {
  if (authorization === undefined) return undefined;
  if (authorization.includes(",")) return undefined;
  const value = authorization.trim();
  if (!value.startsWith("Bearer ")) return undefined;
  const token = value.slice("Bearer ".length).trim();
  if (token === "" || /\s/.test(token)) return undefined;
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  return tokens.get(hash);
}
