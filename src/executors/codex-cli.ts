/**
 * Codex CLI executor
 * Executes jobs using codex exec command
 */

import { execa } from 'execa';
import type { Executor, ExecutorOutput, ExecutorContext } from './base.js';
import type { JobSpec } from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';

interface CodexCliConfig {
  binary: string;
  defaultModel: string;
  enableSearch: boolean;
}

export class CodexCliExecutor implements Executor {
  readonly name = 'codex-cli';

  constructor(private readonly config: CodexCliConfig) {}

  private buildPrompt(spec: JobSpec): string {
    const parts: string[] = [];

    // Task description
    parts.push('# Task');
    parts.push(spec.task.title);
    parts.push('');
    parts.push(spec.task.description);
    parts.push('');

    // Acceptance criteria
    if (spec.task.acceptance.length > 0) {
      parts.push('## Acceptance Criteria');
      spec.task.acceptance.forEach((criterion, i) => {
        parts.push(`${i + 1}. ${criterion}`);
      });
      parts.push('');
    }

    // Scope constraints
    parts.push('## Scope');
    parts.push(`Read paths: ${spec.scope.readPaths.join(', ')}`);
    if (spec.scope.fileGlobs && spec.scope.fileGlobs.length > 0) {
      parts.push(`File globs: ${spec.scope.fileGlobs.join(', ')}`);
    }
    if (spec.scope.disallowReformatting) {
      parts.push('⚠️ Do not reformat existing code');
    }
    parts.push('');

    // Output requirements
    parts.push('## Output Requirements');
    parts.push('You MUST provide your output in exactly THREE sections:');
    parts.push('');
    parts.push('### DIFF');
    parts.push('Complete unified diff of all changes. Use proper git diff format.');
    parts.push('');
    parts.push('### TEST_PLAN');
    parts.push('Detailed test plan describing how to validate the changes.');
    parts.push('');
    parts.push('### NOTES');
    parts.push('Implementation notes, decisions made, and any caveats.');
    parts.push('');

    // Context snippets if provided
    if (spec.context?.codeSnippets && spec.context.codeSnippets.length > 0) {
      parts.push('## Relevant Code Context');
      for (const snippet of spec.context.codeSnippets) {
        parts.push(`\`${snippet.path}\` lines ${snippet.from}-${snippet.to}`);
      }
      parts.push('');
    }

    // Guardrails
    parts.push('## Constraints');
    parts.push('- Read-only sandbox: you can read files but not write directly');
    parts.push('- Only use trusted commands');
    parts.push('- Generate output in the required format above');
    parts.push(`- Baseline commit: ${spec.repo.baselineCommit}`);

    return parts.join('\n');
  }

  private parseOutput(rawOutput: string): Result<ExecutorOutput, string> {
    const diffMatch = /### DIFF\s*\n([\s\S]*?)(?=\n### |$)/i.exec(rawOutput);
    const testPlanMatch = /### TEST_PLAN\s*\n([\s\S]*?)(?=\n### |$)/i.exec(rawOutput);
    const notesMatch = /### NOTES\s*\n([\s\S]*?)(?=\n### |$)/i.exec(rawOutput);

    if (!diffMatch || !testPlanMatch || !notesMatch) {
      return Err(
        'Output missing required sections. Expected ### DIFF, ### TEST_PLAN, and ### NOTES'
      );
    }

    return Ok({
      diff: diffMatch[1]?.trim() ?? '',
      testPlan: testPlanMatch[1]?.trim() ?? '',
      notes: notesMatch[1]?.trim() ?? '',
      rawOutput,
    });
  }

  async execute(
    spec: JobSpec,
    context: ExecutorContext
  ): Promise<Result<ExecutorOutput, string>> {
    try {
      const prompt = this.buildPrompt(spec);
      const model = spec.execution.preferredModel || this.config.defaultModel;

      const args = [
        'exec',
        '--model', model,
        '--sandbox', 'read-only',
        '-a', 'untrusted',
      ];

      if (this.config.enableSearch) {
        args.push('--search');
      }

      // Add prompt as final argument
      args.push(prompt);

      const execOptions: {
        cwd: string;
        timeout?: number;
        reject: boolean;
        all: boolean;
      } = {
        cwd: context.workDir,
        reject: false, // Don't throw on non-zero exit
        all: true, // Combine stdout and stderr
      };

      if (context.timeoutMs !== undefined) {
        execOptions.timeout = context.timeoutMs;
      }

      const result = await execa(this.config.binary, args, execOptions);

      if (result.exitCode !== 0) {
        return Err(
          `Codex CLI failed with exit code ${result.exitCode}: ${result.all ?? result.stderr}`
        );
      }

      const output = result.all ?? result.stdout;
      return this.parseOutput(output);
    } catch (error) {
      if (error && typeof error === 'object' && 'killed' in error && error.killed) {
        return Err('Executor timeout exceeded');
      }
      return Err(
        `Executor failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
