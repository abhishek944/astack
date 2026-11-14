// Copy the built pure core into the Herdr mod folder.
//
// Herdr loads a mod module by relative path from its own folder, so the mod
// cannot import from dist/. The copies are byte-identical to the build output,
// which keeps one implementation for the mod, the CLI and the extension.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "dist", "core");
const target = join(root, "herdr", "pi-schedulers", "core");

const files = (await readdir(source)).filter((name) => name.endsWith(".js")).sort();
if (files.length === 0) throw new Error(`No built core modules in ${source}. Run tsc first.`);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of files) {
  const contents = await readFile(join(source, name));
  await mkdir(dirname(join(target, name)), { recursive: true });
  await writeFile(join(target, name), contents);
  process.stdout.write(`mod core: ${name}\n`);
}
