// Copy the built pure core into the Herdr mod folder.
//
// Herdr loads a mod module by relative path from its own folder, so the mod
// cannot import from dist/. The copies are byte-identical to the build output,
// which keeps one implementation of the policy and selection rules for the
// panel and the host command.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "dist", "core");
const target = join(root, "herdr", "pi-routing", "core");

const files = (await readdir(source)).filter((name) => name.endsWith(".js")).sort();
if (files.length === 0) throw new Error(`No built core modules in ${source}. Run tsc first.`);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of files) {
  await writeFile(join(target, name), await readFile(join(source, name)));
  process.stdout.write(`mod core: ${name}\n`);
}
