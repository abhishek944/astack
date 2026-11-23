import { isProjectTrusted } from '@amaster.ai/pi-shared/settings';
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { EmbeddingsError } from './errors.js';
import {
  createEmbeddingsRuntimeWithDiagnostics,
  type EmbeddingsRuntimeWithDiagnostics,
} from './runtime.js';
import { loadEmbeddingSettings, validateEmbeddingSettings } from './settings.js';
import { updateProjectEmbeddingSettings } from './settings-write.js';
import {
  EMBEDDINGS_SETTINGS_KEY,
  type EmbeddingRoute,
  type EmbeddingSettings,
} from './schemas.js';
import {
  EMBED_COMPARE_TOOL,
  EMBED_TOOL,
  EMBED_COMPARE_TOOL_DESCRIPTION,
  EMBED_TOOL_DESCRIPTION,
  embedCompareOutput,
  embedCompareParameters,
  embedOutput,
  embedParameters,
} from './tool-contracts.js';

const summary = (result: {
  outcomes: readonly { readonly status: string; readonly route?: string; readonly model?: string }[];
}): string => {
  const successes = result.outcomes.filter((outcome) => outcome.status === 'success');
  const routes = [...new Set(successes.map((outcome) => `${outcome.route}:${outcome.model}`))].join(', ');
  return `Embedded ${successes.length}/${result.outcomes.length} input(s)${routes === '' ? '' : ` via ${routes}`}.`;
};

const codeOf = (error: unknown): string =>
  error instanceof EmbeddingsError ? error.code : 'configuration-invalid';

const signalOptions = (signal: AbortSignal | undefined) =>
  signal === undefined ? {} : { signal };

export default function piEmbeddingsExtension(pi: ExtensionAPI): void {
  let settings: EmbeddingSettings | undefined;
  let runtime: EmbeddingsRuntimeWithDiagnostics | undefined;
  let cwd = process.cwd();

  const refresh = async (next: EmbeddingSettings, nextCwd = cwd): Promise<void> => {
    await runtime?.close();
    settings = next;
    cwd = nextCwd;
    runtime = createEmbeddingsRuntimeWithDiagnostics({ settings: next, cwd: nextCwd });
  };

  const currentRuntime = (ctx: ExtensionContext): EmbeddingsRuntimeWithDiagnostics => {
    if (runtime === undefined || cwd !== ctx.cwd)
      throw new EmbeddingsError('configuration-invalid');
    return runtime;
  };

  pi.on('session_start', async (_event: unknown, ctx: ExtensionContext) => {
    await refresh(loadEmbeddingSettings(ctx.cwd, isProjectTrusted(ctx)), ctx.cwd);
  });

  pi.on('session_shutdown', async () => {
    await runtime?.close();
    runtime = undefined;
  });

  pi.registerTool(
    defineTool({
      name: EMBED_TOOL,
      label: 'Embed text',
      description: EMBED_TOOL_DESCRIPTION,
      promptSnippet:
        'Return text vectors and their actual generating space using the configured embedding route; full input text is preserved and the package owns provider batching.',
      promptGuidelines: [
        'Provider, model, credentials and caller storage policy are fixed by trusted settings and cannot be overridden through this tool.',
        'Use embed_compare only when the user explicitly asks to compare configured embedding routes.',
        'The embed result reports the actual generating provider, model and space, including mixed fallback generations.',
      ],
      parameters: embedParameters,
      outputSchema: embedOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      async execute(_id, params, signal, _onUpdate, ctx) {
        try {
          const result = await currentRuntime(ctx).embed(params, signalOptions(signal ?? undefined));
          return {
            content: [{ type: 'text', text: summary(result) }],
            details: result,
            structuredContent: result,
          };
        } catch (error) {
          throw new Error(codeOf(error));
        }
      },
    })
  );

  pi.registerTool(
    defineTool({
      name: EMBED_COMPARE_TOOL,
      label: 'Compare embedding routes',
      description: EMBED_COMPARE_TOOL_DESCRIPTION,
      promptSnippet:
        'Compare configured embedding routes only on explicit user request; each entry is labeled and may incur charges.',
      promptGuidelines: [
        'Never use comparison to recover from an ordinary embedding failure.',
        'Each configured entry is an independent request with its own usage and generating space; results are not merged or ranked.',
      ],
      parameters: embedCompareParameters,
      outputSchema: embedCompareOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      async execute(_id, params, signal, _onUpdate, ctx) {
        try {
          const result = await currentRuntime(ctx).compare(params, signalOptions(signal ?? undefined));
          return {
            content: [
              { type: 'text', text: `Compared ${result.entries.length} configured embedding route(s).` },
            ],
            details: result,
            structuredContent: result,
          };
        } catch (error) {
          throw new Error(codeOf(error));
        }
      },
    })
  );

  pi.registerCommand('embeddings', {
    description:
      'Embeddings: /embeddings list | doctor | reload | use <provider> <model> | compare <text>. list and doctor make no inference calls.',
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const raw = (args ?? '').trim();
      const parts = raw.split(/\s+/).filter(Boolean);
      const command = parts[0] ?? 'list';
      try {
        if (command === 'list' || command === 'doctor' || command === 'status') {
          if (parts.length !== 1) throw new EmbeddingsError('configuration-invalid');
          const active = currentRuntime(ctx);
          const described = active.describe();
          if (command === 'doctor') {
            reply(
              pi,
              ctx,
              described.diagnostics.length === 0
                ? 'Embeddings settings are valid. No provider call was made.'
                : described.diagnostics.map((entry) => `${entry.severity}: ${entry.code}`).join('\n')
            );
            return;
          }
          reply(
            pi,
            ctx,
            JSON.stringify(
              {
                selected: described.selected,
                space: described.space,
                default: described.default,
                fallback: described.fallback,
                compare: described.compare,
                ready: described.ready,
              },
              null,
              2
            )
          );
          return;
        }
        if (command === 'reload') {
          if (parts.length !== 1) throw new EmbeddingsError('configuration-invalid');
          const next = loadEmbeddingSettings(ctx.cwd, isProjectTrusted(ctx));
          await refresh(next, ctx.cwd);
          reply(pi, ctx, `${EMBEDDINGS_SETTINGS_KEY} settings reloaded. No inference was run.`);
          return;
        }
        if (command === 'use') {
          if (parts.length !== 3) throw new EmbeddingsError('configuration-invalid');
          const route: EmbeddingRoute = { provider: parts[1] as EmbeddingRoute['provider'], model: parts[2] ?? '' };
          validateEmbeddingSettings({ default: route });
          await updateProjectEmbeddingSettings({
            cwd: ctx.cwd,
            projectTrusted: isProjectTrusted(ctx),
            route,
          });
          await refresh(loadEmbeddingSettings(ctx.cwd, isProjectTrusted(ctx)), ctx.cwd);
          reply(pi, ctx, `Selected ${route.provider}/${route.model} in trusted project settings.`);
          return;
        }
        if (command === 'compare') {
          const text = raw.slice('compare'.length).trim();
          if (text === '') throw new EmbeddingsError('configuration-invalid');
          const result = await currentRuntime(ctx).compare({ inputs: [text] }, signalOptions(ctx.signal ?? undefined));
          reply(pi, ctx, `Compared ${result.entries.length} configured route(s).\n${summary(result.entries[0]?.result ?? { outcomes: [] })}`);
          return;
        }
        reply(pi, ctx, 'Usage: /embeddings list | doctor | reload | use <provider> <model> | compare <text>');
      } catch (error) {
        reply(pi, ctx, `Embeddings command failed: ${codeOf(error)}`);
      }
    },
  });
}

function reply(pi: ExtensionAPI, ctx: ExtensionContext, text: string): void {
  if (ctx.hasUI) ctx.ui.notify(text, 'info');
  else pi.sendMessage({ customType: 'pi-embeddings', content: text, display: true }, { triggerTurn: false });
}
