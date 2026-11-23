import { ImageGenError } from '../errors.js';
import type { ApiStyle, ImageProviderAdapter } from '../types.js';
import { adobeFireflyAdapter } from './adobe-firefly.js';
import { arkAdapter } from './ark.js';
import { bflAdapter } from './bfl.js';
import { cloudflareImageAdapter } from './cloudflare.js';
import { codexAdapter } from './codex.js';
import { dashscopeAdapter } from './dashscope.js';
import { geminiAdapter } from './gemini.js';
import { maiAdapter } from './mai.js';
import { metaAdapter } from './meta.js';
import { openaiAdapter } from './openai.js';
import { openrouterAdapter } from './openrouter.js';
import { recraftAdapter } from './recraft.js';
import { stabilityAdapter } from './stability.js';

const ADAPTERS: Record<ApiStyle, ImageProviderAdapter> = {
  openai: openaiAdapter,
  gemini: geminiAdapter,
  dashscope: dashscopeAdapter,
  openrouter: openrouterAdapter,
  cloudflare: cloudflareImageAdapter,
  ark: arkAdapter,
  meta: metaAdapter,
  mai: maiAdapter,
  codex: codexAdapter,
  bfl: bflAdapter,
  'adobe-firefly': adobeFireflyAdapter,
  stability: stabilityAdapter,
  recraft: recraftAdapter,
};

export function getAdapter(api: ApiStyle): ImageProviderAdapter {
  const adapter = ADAPTERS[api];
  if (!adapter) throw new ImageGenError(`Unsupported api "${api}".`, `unsupported api "${api}"`);
  return adapter;
}
