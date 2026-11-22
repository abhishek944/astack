// MCP-only catalog for the standalone stdio server. The argument schemas come
// from the package-owned tool contracts shared with the Pi extension and the
// Durable factory; this module only adapts them to MCP metadata and validation.

import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import {
  CLASSIFIER_BOX_TOOL,
  CLASSIFIER_BOX_TOOL_DESCRIPTION,
  CLASSIFY_COMPARE_TOOL,
  CLASSIFY_COMPARE_TOOL_DESCRIPTION,
  CLASSIFY_EXTRACT_TOOL,
  CLASSIFY_EXTRACT_TOOL_DESCRIPTION,
  CLASSIFY_TOOL,
  CLASSIFY_TOOL_DESCRIPTION,
  CLASSIFY_TREE_TOOL,
  CLASSIFY_TREE_TOOL_DESCRIPTION,
  boxParameters,
  classifyExtractParameters,
  classifyParameters,
  classifyTreeParameters,
} from './tool-contracts.js';

export type ClassifierMcpToolName =
  | typeof CLASSIFY_TOOL
  | typeof CLASSIFY_COMPARE_TOOL
  | typeof CLASSIFY_TREE_TOOL
  | typeof CLASSIFY_EXTRACT_TOOL
  | typeof CLASSIFIER_BOX_TOOL;

export interface ClassifierMcpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export interface ClassifierMcpToolDefinition {
  name: ClassifierMcpToolName;
  description: string;
  inputSchema: TSchema;
  annotations: ClassifierMcpToolAnnotations;
}

const providerAnnotations: ClassifierMcpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
};

const localAnnotations: ClassifierMcpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

/** Excludes Pi-only computer use; all portable package tools are exposed. */
export const CLASSIFIER_MCP_TOOL_DEFINITIONS: readonly ClassifierMcpToolDefinition[] = [
  {
    name: CLASSIFY_TOOL,
    description: CLASSIFY_TOOL_DESCRIPTION,
    inputSchema: classifyParameters,
    annotations: providerAnnotations,
  },
  {
    name: CLASSIFY_COMPARE_TOOL,
    description: CLASSIFY_COMPARE_TOOL_DESCRIPTION,
    inputSchema: classifyParameters,
    annotations: providerAnnotations,
  },
  {
    name: CLASSIFY_TREE_TOOL,
    description: CLASSIFY_TREE_TOOL_DESCRIPTION,
    inputSchema: classifyTreeParameters,
    annotations: providerAnnotations,
  },
  {
    name: CLASSIFY_EXTRACT_TOOL,
    description: CLASSIFY_EXTRACT_TOOL_DESCRIPTION,
    inputSchema: classifyExtractParameters,
    annotations: providerAnnotations,
  },
  {
    name: CLASSIFIER_BOX_TOOL,
    description: CLASSIFIER_BOX_TOOL_DESCRIPTION,
    inputSchema: boxParameters,
    annotations: localAnnotations,
  },
];

/** Return human-readable validation problems; an empty array means the arguments are valid. */
export function validateMcpToolArguments(tool: ClassifierMcpToolDefinition, args: unknown): string[] {
  if (Value.Check(tool.inputSchema, args)) return [];
  const problems = new Set<string>();
  for (const error of Value.Errors(tool.inputSchema, args)) {
    if (error.keyword === 'boolean') continue;
    const path = error.instancePath || 'arguments';
    const unknown = error.keyword === 'additionalProperties'
      ? (error.params as { additionalProperties?: string[] }).additionalProperties
      : undefined;
    problems.add(unknown?.length ? `${path}: unknown properties ${unknown.join(', ')}` : `${path}: ${error.message}`);
  }
  return problems.size > 0 ? [...problems] : ['arguments do not match the input schema'];
}
