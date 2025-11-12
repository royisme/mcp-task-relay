/**
 * Prompt Builder
 * Implements Phase 2 prompt layering: Base → Role → Context → Task
 */

import type { RoleDefinition } from './role-catalog.js';
import type { AskRecord } from '../models/index.js';

export interface PromptLayers {
  base: string;
  role?: string;
  context?: string;
  task: string;
}

export class PromptBuilder {
  /**
   * Build a complete prompt from layers
   */
  build(layers: PromptLayers): string {
    const parts: string[] = [];

    // Layer 1: Base
    parts.push(layers.base);

    // Layer 2: Role (if provided)
    if (layers.role) {
      parts.push('\n---\n');
      parts.push(layers.role);
    }

    // Layer 3: Context (if provided)
    if (layers.context) {
      parts.push('\n---\n');
      parts.push(layers.context);
    }

    // Layer 4: Task
    parts.push('\n---\n');
    parts.push(layers.task);

    return parts.join('');
  }

  /**
   * Build base layer (JSON-only output rules, safety, size limits)
   */
  buildBaseLayer(): string {
    return `You are the SCHEDULER of mcp-task-relay.

PURPOSE
- Answer Ask messages from the Executor with minimal, actionable results.
- Run code and call MCP tools ONLY inside your own answer-runner. Do not expose tool schemas or verbose traces unless asked by policy.
- Always return a single JSON object. No extra text before or after the JSON.

OUTPUT CONTRACT
- Return JSON with these fields: answer_text (optional string), answer_json (optional structured data), ask_back (optional follow-up question).
- Keep answer_text ≤ 1000 chars and answer_json ≤ 200 lines if possible. Summarize aggressively.
- If the output schema is specified in the task, you MUST match it exactly.

BEHAVIOR
- Only load MCP tools explicitly allowed. If none, use the smallest safe set or pure reasoning.
- If information is insufficient, put your brief question into ask_back. Do NOT invent facts.
- On errors/timeouts: provide a concise error description.

GUARDRAILS
- JSON-only; minimize tokens; deterministic field order; no side-effects unless policy allows.`;
  }

  /**
   * Build role layer from role definition
   */
  buildRoleLayer(role: RoleDefinition): string {
    const parts: string[] = [];

    parts.push(`ROLE: ${role.id} (v${role.version})`);
    parts.push(`PURPOSE: ${role.purpose}`);
    parts.push('');
    parts.push('SYSTEM INSTRUCTIONS:');
    parts.push(role.system);

    if (role.input_schema) {
      parts.push('');
      parts.push('INPUT SCHEMA:');
      parts.push(role.input_schema);
    }

    if (role.output_schema) {
      parts.push('');
      parts.push('OUTPUT SCHEMA (you MUST match this exactly):');
      parts.push(role.output_schema);
    }

    if (role.tool_whitelist && role.tool_whitelist.length > 0) {
      parts.push('');
      parts.push('ALLOWED TOOLS:');
      parts.push(role.tool_whitelist.map((t) => `  - ${t}`).join('\n'));
    }

    if (role.limits) {
      parts.push('');
      parts.push('LIMITS:');
      if (role.limits.max_tokens) {
        parts.push(`  - Maximum output tokens: ${role.limits.max_tokens}`);
      }
      if (role.limits.max_tool_calls) {
        parts.push(`  - Maximum tool calls: ${role.limits.max_tool_calls}`);
      }
    }

    if (role.guardrails && role.guardrails.length > 0) {
      parts.push('');
      parts.push('GUARDRAILS:');
      parts.push(role.guardrails.map((g) => `  - ${g}`).join('\n'));
    }

    return parts.join('\n');
  }

  /**
   * Build context layer (minimal facts + optional MCP tool whitelist)
   */
  buildContextLayer(ask: AskRecord): string {
    const parts: string[] = [];

    parts.push('CONTEXT');
    parts.push(`Job ID: ${ask.jobId}`);
    parts.push(`Step ID: ${ask.stepId}`);
    parts.push(`Ask Type: ${ask.askType}`);

    if (ask.constraints?.allowed_tools && ask.constraints.allowed_tools.length > 0) {
      parts.push('');
      parts.push('Allowed tools for this Ask:');
      parts.push(ask.constraints.allowed_tools.map((t) => `  - ${t}`).join('\n'));
    }

    if (ask.constraints?.timeout_s) {
      parts.push('');
      parts.push(`Timeout: ${ask.constraints.timeout_s}s`);
    }

    if (ask.constraints?.max_tokens) {
      parts.push('');
      parts.push(`Max tokens: ${ask.constraints.max_tokens}`);
    }

    if (ask.meta) {
      parts.push('');
      parts.push('Metadata:');
      parts.push(JSON.stringify(ask.meta, null, 2));
    }

    return parts.join('\n');
  }

  /**
   * Build task layer (Ask prompt and output schema instructions)
   */
  buildTaskLayer(ask: AskRecord): string {
    const parts: string[] = [];

    parts.push('TASK');
    parts.push('');
    parts.push(ask.prompt);

    // Add any prompt overrides from meta
    if (ask.meta && typeof ask.meta === 'object' && 'prompt_overrides' in ask.meta) {
      const overrides = ask.meta['prompt_overrides'] as {
        system_append?: string;
        output_schema?: unknown;
      };

      if (overrides.system_append) {
        parts.push('');
        parts.push('ADDITIONAL INSTRUCTIONS:');
        parts.push(overrides.system_append);
      }

      if (overrides.output_schema) {
        parts.push('');
        parts.push('REQUIRED OUTPUT SCHEMA:');
        parts.push(JSON.stringify(overrides.output_schema, null, 2));
      }
    }

    parts.push('');
    parts.push('Remember: Return ONLY a JSON object with answer_text, answer_json, and/or ask_back fields.');

    return parts.join('\n');
  }
}
