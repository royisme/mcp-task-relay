/**
 * Claude Code executor
 * Executes jobs using Claude Code CLI with exec/agent mode
 */

import { execa } from 'execa';
import type { Executor, ExecutorOutput, ExecutorContext } from './base.js';
import type { JobSpec } from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';

interface ClaudeCodeConfig {
  binary: string;
  defaultModel: string;
}

export class ClaudeCodeExecutor implements Executor {
  readonly name = 'claude-code';

  constructor(private readonly config: ClaudeCodeConfig) {}

  private buildPrompt(spec: JobSpec): string {
    const parts: string[] = [];

    parts.push('You are executing as a sub-agent to generate code changes.');
    parts.push('');

    // Task
    parts.push(`# Task: ${spec.task.title}`);
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

    // Scope
    parts.push('## Scope');
    parts.push(`- Focus on: ${spec.scope.readPaths.join(', ')}`);
    if (spec.scope.fileGlobs) {
      parts.push(`- File patterns: ${spec.scope.fileGlobs.join(', ')}`);
    }
    if (spec.scope.disallowReformatting) {
      parts.push('- ⚠️ Do NOT reformat existing code');
    }
    parts.push('');

    // Output format
    parts.push('## Required Output Format');
    parts.push('');
    parts.push('You MUST structure your response with these THREE sections:');
    parts.push('');
    parts.push('### DIFF');
    parts.push('```diff');
    parts.push('// Unified diff of all your changes in git diff format');
    parts.push('```');
    parts.push('');
    parts.push('### TEST_PLAN');
    parts.push('Detailed test plan to validate these changes.');
    parts.push('');
    parts.push('### NOTES');
    parts.push('Implementation notes, design decisions, and considerations.');
    parts.push('');

    // Context
    if (spec.context?.codeSnippets && spec.context.codeSnippets.length > 0) {
      parts.push('## Code Context');
      for (const snippet of spec.context.codeSnippets) {
        parts.push(`- \`${snippet.path}\`:${snippet.from}-${snippet.to}`);
      }
      parts.push('');
    }

    // Constraints
    parts.push('## Constraints');
    parts.push('- Read-only analysis (generate patches, don\'t write files)');
    parts.push(`- Base on commit: ${spec.repo.baselineCommit}`);
    parts.push('- Follow the exact output format above');

    return parts.join('\n');
  }

  private parseOutput(rawOutput: string): Result<ExecutorOutput, string> {
    // Try to extract sections from Claude's response
    const diffMatch = /### DIFF\s*\n```diff\s*\n([\s\S]*?)\n```/i.exec(rawOutput) ||
                      /### DIFF\s*\n([\s\S]*?)(?=\n### |$)/i.exec(rawOutput);

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

      // Use Claude Code in exec/agent mode
      // Assuming format: claude --exec --model <model> <prompt>
      const args = [
        '--exec',
        '--model', spec.execution.preferredModel || this.config.defaultModel,
        '--',
        prompt,
      ];

      const execOptions: {
        cwd: string;
        timeout?: number;
        reject: boolean;
        all: boolean;
      } = {
        cwd: context.workDir,
        reject: false,
        all: true,
      };

      if (context.timeoutMs !== undefined) {
        execOptions.timeout = context.timeoutMs;
      }

      const result = await execa(this.config.binary, args, execOptions);

      if (result.exitCode !== 0) {
        return Err(
          `Claude Code failed with exit code ${result.exitCode}: ${result.all ?? result.stderr}`
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
