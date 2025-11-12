/**
 * Answer Runner
 * Core execution engine for processing Ask requests and generating Answers
 */

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import type { Logger } from 'pino';
import type { AskRecord, AnswerStatus, Attestation } from '../models/index.js';
import { AskAnswerErrors } from '../models/index.js';
import { stableHashContext, getEnvelopeValue } from '../utils/index.js';
import { RoleCatalog } from './role-catalog.js';
import { PromptBuilder } from './prompt-builder.js';

export interface AnswerResult {
  status: AnswerStatus;
  answerText?: string;
  answerJson?: unknown;
  attestation?: Attestation;
  askBack?: string;
  error?: string;
  policyTrace?: unknown;
  cacheable?: boolean;
}

export interface RunnerConfig {
  apiKey?: string;
  model?: string;
  maxRetries?: number;
  defaultTimeout?: number;
  promptsDir: string;
}

export class AnswerRunner {
  private readonly anthropic: Anthropic;
  private readonly catalog: RoleCatalog;
  private readonly builder: PromptBuilder;
  private readonly config: Required<RunnerConfig>;

  constructor(config: RunnerConfig, private readonly logger: Logger) {
    this.config = {
      apiKey: config.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '',
      model: config.model ?? 'claude-3-5-sonnet-20241022',
      maxRetries: config.maxRetries ?? 1,
      defaultTimeout: config.defaultTimeout ?? 60,
      promptsDir: config.promptsDir,
    };

    if (!this.config.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Answer Runner');
    }

    this.anthropic = new Anthropic({ apiKey: this.config.apiKey });
    this.catalog = new RoleCatalog(this.config.promptsDir, logger);
    this.builder = new PromptBuilder();
  }

  /**
   * Process an Ask and generate an Answer
   */
  async run(ask: AskRecord): Promise<AnswerResult> {
    this.logger.info({ askId: ask.askId, askType: ask.askType }, 'Processing Ask');

    // Verify context hash (fail-fast on mismatch)
    const computedHash = stableHashContext(ask.contextEnvelope);
    if (computedHash !== ask.contextHash) {
      this.logger.error(
        {
          askId: ask.askId,
          expectedHash: ask.contextHash,
          computedHash,
        },
        `Context hash mismatch - ${AskAnswerErrors.E_CONTEXT_MISMATCH}`
      );
      return {
        status: 'ERROR',
        error: `${AskAnswerErrors.E_CONTEXT_MISMATCH}: Context hash verification failed. Expected ${ask.contextHash}, computed ${computedHash}`,
        cacheable: false,
      };
    }

    // Load role definition
    const roleId = ask.roleId ?? this.catalog.getDefaultRoleForType(ask.askType);
    const role = roleId ? this.catalog.load(roleId) : null;

    if (ask.roleId && !role) {
      return {
        status: 'ERROR',
        error: `Role not found: ${ask.roleId}`,
        cacheable: false,
      };
    }

    // Build prompt layers
    const layers: {
      base: string;
      role?: string;
      context?: string;
      task: string;
    } = {
      base: this.builder.buildBaseLayer(),
      context: this.builder.buildContextLayer(ask),
      task: this.builder.buildTaskLayer(ask),
    };

    if (role) {
      layers.role = this.builder.buildRoleLayer(role);
    }

    const prompt = this.builder.build(layers);

    // Determine timeout and max tokens
    const timeout = ask.constraints?.timeout_s ?? this.config.defaultTimeout;
    const maxTokens = ask.constraints?.max_tokens ?? role?.limits?.max_tokens ?? 4096;

    // Try to get an answer (with retry)
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.callLLM(prompt, maxTokens, timeout);
        const parsed = this.parseResponse(result);

        // Validate JSON if output schema is specified
        if (role?.output_schema && parsed.answerJson) {
          const valid = this.validateJsonSchema(parsed.answerJson, role.output_schema);
          if (!valid && attempt < this.config.maxRetries) {
            this.logger.warn(
              { askId: ask.askId, attempt },
              'JSON validation failed, retrying'
            );
            lastError = new Error('JSON schema validation failed');
            continue;
          }
          if (!valid) {
            // Downgrade to text summary on final retry
            return {
              status: 'ANSWERED',
              answerText: `Schema validation failed. Raw output: ${JSON.stringify(parsed.answerJson)}`,
              cacheable: false,
            };
          }
        }

        // Generate attestation for the answer
        const attestation = this.generateAttestation(
          ask,
          roleId ?? 'default',
          String(role?.version ?? '1.0'),
          prompt,
          ask.constraints?.allowed_tools ?? []
        );

        return {
          status: 'ANSWERED',
          ...parsed,
          attestation,
          cacheable: true,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          {
            askId: ask.askId,
            attempt,
            error: lastError.message,
          },
          'LLM call failed'
        );

        if (attempt < this.config.maxRetries) {
          // Exponential backoff
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    // All retries failed
    return {
      status: 'ERROR',
      error: lastError?.message ?? 'Unknown error',
      cacheable: false,
    };
  }

  /**
   * Call the LLM with the given prompt
   */
  private async callLLM(
    prompt: string,
    maxTokens: number,
    timeoutSeconds: number
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
      const response = await this.anthropic.messages.create(
        {
          model: this.config.model,
          max_tokens: maxTokens,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        },
        {
          signal: controller.signal,
        }
      );

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in LLM response');
      }

      return textContent.text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse LLM response and extract answer fields
   */
  private parseResponse(text: string): {
    answerText?: string;
    answerJson?: unknown;
    askBack?: string;
  } {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // No JSON found, treat entire response as text
      return { answerText: text.trim() };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      const result: {
        answerText?: string;
        answerJson?: unknown;
        askBack?: string;
      } = {};

      if (typeof parsed['answer_text'] === 'string') {
        result.answerText = parsed['answer_text'];
      }

      if (parsed['answer_json'] !== undefined) {
        result.answerJson = parsed['answer_json'];
      }

      if (typeof parsed['ask_back'] === 'string') {
        result.askBack = parsed['ask_back'];
      }

      return result;
    } catch {
      // JSON parsing failed, return as text
      return { answerText: text.trim() };
    }
  }

  /**
   * Validate JSON against a schema (basic check)
   * In production, use a proper JSON Schema validator like Ajv
   */
  private validateJsonSchema(data: unknown, schemaString: string): boolean {
    try {
      // For now, just check that we can parse the schema and data is an object/array
      const schema = JSON.parse(schemaString) as { type?: string };
      if (schema.type === 'object') {
        return typeof data === 'object' && data !== null && !Array.isArray(data);
      }
      if (schema.type === 'array') {
        return Array.isArray(data);
      }
      return true; // Allow any type if not specified
    } catch {
      // Schema parsing failed, skip validation
      return true;
    }
  }

  /**
   * Sleep for the specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate attestation for an answer
   */
  private generateAttestation(
    ask: AskRecord,
    roleId: string,
    roleVersion: string,
    prompt: string,
    toolsUsed: string[]
  ): Attestation {
    // Generate prompt fingerprint (SHA-256 hash of the prompt)
    const promptFingerprint = createHash('sha256').update(prompt, 'utf8').digest('hex');

    return {
      context_hash: ask.contextHash,
      role_id: roleId,
      role_version: roleVersion,
      model: this.config.model,
      prompt_fingerprint: promptFingerprint,
      tools_used: toolsUsed,
      policy_version: String(getEnvelopeValue(ask.contextEnvelope, 'policy_version', '1.0')),
    };
  }
}
