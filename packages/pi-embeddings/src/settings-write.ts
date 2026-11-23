import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { join, resolve } from 'node:path';
import { validateEmbeddingSettings } from './settings.js';
import { EMBEDDINGS_SETTINGS_KEY, type EmbeddingRoute } from './schemas.js';

export class EmbeddingsSettingsWriteError extends Error {}

/** Update only the trusted project's `pi-embeddings.default`, preserving every unrelated key. */
export function updateProjectEmbeddingSettings({
  cwd,
  projectTrusted,
  route,
}: {
  cwd: string;
  projectTrusted: boolean;
  route: EmbeddingRoute;
}): Promise<void> {
  validateEmbeddingSettings({ default: route });
  const settingsPath = resolve(cwd, '.pi', 'settings.json');
  return withFileMutationQueue(settingsPath, () =>
    updateProjectEmbeddingSettingsNow({ cwd, projectTrusted, route })
  );
}

async function updateProjectEmbeddingSettingsNow(args: {
  cwd: string;
  projectTrusted: boolean;
  route: EmbeddingRoute;
}): Promise<void> {
  if (!args.projectTrusted)
    throw new EmbeddingsSettingsWriteError(
      'Project settings are not trusted. Trust this project before changing .pi/settings.json.'
    );
  const settingsDir = join(args.cwd, '.pi');
  const settingsPath = join(settingsDir, 'settings.json');
  await rejectSymlink(settingsDir);
  await mkdir(settingsDir, { recursive: true, mode: 0o700 });
  await rejectSymlink(settingsPath);

  let root: Record<string, unknown> = {};
  let mode = 0o600;
  try {
    const [text, stat] = await Promise.all([readFile(settingsPath, 'utf8'), lstat(settingsPath)]);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new EmbeddingsSettingsWriteError('Project settings must contain a JSON object.');
    root = { ...parsed } as Record<string, unknown>;
    mode = stat.mode & 0o777;
  } catch (error) {
    if (error instanceof EmbeddingsSettingsWriteError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      if (error instanceof SyntaxError)
        throw new EmbeddingsSettingsWriteError(
          'Project settings contain invalid JSON. Fix .pi/settings.json before changing embedding settings.'
        );
      throw new EmbeddingsSettingsWriteError('Could not read project settings.');
    }
  }

  const current = root[EMBEDDINGS_SETTINGS_KEY];
  if (current !== undefined && (typeof current !== 'object' || current === null || Array.isArray(current)))
    throw new EmbeddingsSettingsWriteError(
      'pi-embeddings settings must contain a JSON object.'
    );
  root[EMBEDDINGS_SETTINGS_KEY] = { ...(current ?? {}), default: args.route };

  const tempPath = join(settingsDir, `.settings.json.pi-embeddings-${randomUUID()}`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    handle = await open(tempPath, 'wx', mode);
    created = true;
    await handle.writeFile(`${JSON.stringify(root, null, 2)}\n`, 'utf8');
    await handle.close();
    handle = undefined;
    await rename(tempPath, settingsPath);
  } catch {
    if (handle) await handle.close().catch(() => undefined);
    if (created) await unlink(tempPath).catch(() => undefined);
    throw new EmbeddingsSettingsWriteError('Could not update project settings.');
  }
}

async function rejectSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new EmbeddingsSettingsWriteError('The project settings path must not be a symbolic link.');
  } catch (error) {
    if (error instanceof EmbeddingsSettingsWriteError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new EmbeddingsSettingsWriteError('Could not inspect project settings.');
  }
}
