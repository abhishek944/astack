import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPiSettings, resolveConfigDir } from '@amaster.ai/pi-shared/settings';
import { Value } from 'typebox/value';
import { EmbeddingsError } from './errors.js';
import {
  EMBEDDINGS_SETTINGS_KEY,
  GATEWAY_EMBEDDING_MODELS,
  embeddingSettingsSchema,
  type EmbeddingRoute,
  type EmbeddingSettings,
} from './schemas.js';

const MODELS_BY_PROVIDER: Readonly<Record<EmbeddingRoute['provider'], readonly string[]>> = {
  local: ['embeddinggemma-2'],
  openai: ['text-embedding-3-small'],
  sarvam: ['embeddinggemma-2'],
  gateway: GATEWAY_EMBEDDING_MODELS,
};

export const isEmbeddingSettings = (value: unknown): value is EmbeddingSettings =>
  Value.Check(embeddingSettingsSchema, value);

function configuration(message: EmbeddingErrorCodeMessage): never {
  throw new EmbeddingsError(message);
}

type EmbeddingErrorCodeMessage = ConstructorParameters<typeof EmbeddingsError>[0];

function assertRoute(value: unknown, location: string): EmbeddingRoute {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return configuration('configuration-invalid');
  const record = value as Record<string, unknown>;
  const provider = record.provider;
  const model = record.model;
  if (typeof provider !== 'string' || typeof model !== 'string' || model.length === 0)
    return configuration('configuration-invalid');
  if (!Object.hasOwn(MODELS_BY_PROVIDER, provider))
    return configuration('configuration-invalid');
  const allowed = MODELS_BY_PROVIDER[provider as EmbeddingRoute['provider']];
  if (allowed === undefined || !allowed.includes(model))
    return configuration('configuration-invalid');
  return { provider: provider as EmbeddingRoute['provider'], model };
}

/** Validate the whole settings object before any route is resolved or inference is attempted. */
export function validateEmbeddingSettings(value: unknown): EmbeddingSettings {
  if (!isEmbeddingSettings(value)) return configuration('configuration-invalid');
  assertRoute(value.default, 'default');
  for (const [index, route] of (value.fallback ?? []).entries())
    assertRoute(route, `fallback[${index}]`);
  for (const [index, route] of (value.compare ?? []).entries())
    assertRoute(route, `compare[${index}]`);
  if (value.version !== undefined && value.version !== 1)
    return configuration('configuration-invalid');
  return value;
}

function validateSettingsLayer(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (text.charCodeAt(0) === 0xfeff) return configuration('configuration-invalid');
  const root: unknown = JSON.parse(text);
  if (
    typeof root !== 'object' ||
    root === null ||
    Array.isArray(root) ||
    (Object.hasOwn(root, EMBEDDINGS_SETTINGS_KEY) &&
      (typeof (root as Record<string, unknown>)[EMBEDDINGS_SETTINGS_KEY] !== 'object' ||
       (root as Record<string, unknown>)[EMBEDDINGS_SETTINGS_KEY] === null ||
       Array.isArray((root as Record<string, unknown>)[EMBEDDINGS_SETTINGS_KEY])))
  )
    return configuration('configuration-invalid');
}

/** Shared precedence: global < agent config < explicitly trusted project. */
export function loadEmbeddingSettings(cwd: string, projectTrusted = false): EmbeddingSettings {
  try {
    const paths = new Set([
      join(resolveConfigDir(join(homedir(), '.pi', 'agent')), 'settings.json'),
      join(resolveConfigDir(), 'settings.json'),
      ...(projectTrusted ? [join(resolve(cwd), '.pi', 'settings.json')] : []),
    ]);
    for (const path of paths) {
      statSync(path, { throwIfNoEntry: false });
      validateSettingsLayer(path);
    }
    const raw = loadPiSettings<unknown>(EMBEDDINGS_SETTINGS_KEY, {
      cwd,
      projectTrusted,
      strictProjectSettings: true,
    });
    return validateEmbeddingSettings(raw);
  } catch (error) {
    if (error instanceof EmbeddingsError) throw error;
    return configuration('configuration-invalid');
  }
}

export const configuredDefault = (settings: EmbeddingSettings): EmbeddingRoute =>
  assertRoute(settings.default, 'default');

export const configuredRoutes = (
  settings: EmbeddingSettings,
  kind: 'fallback' | 'compare'
): readonly EmbeddingRoute[] => {
  const raw = kind === 'fallback' ? settings.fallback : settings.compare;
  return (raw ?? []).map((route, index) => assertRoute(route, `${kind}[${index}]`));
};
