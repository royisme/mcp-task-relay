/**
 * Executor factory
 */

import type { Executor } from './base.js';
import { CodexCliExecutor } from './codex-cli.js';
import { ClaudeCodeExecutor } from './claude-code.js';
import type { Config } from '../config/index.js';

export function createExecutors(config: Config): Executor[] {
  const executors: Executor[] = [];

  if (config.executors.codexCli.enabled) {
    executors.push(
      new CodexCliExecutor({
        binary: config.executors.codexCli.binary,
        defaultModel: config.executors.codexCli.defaultModel,
        enableSearch: config.executors.codexCli.enableSearch,
      })
    );
  }

  if (config.executors.claudeCode.enabled) {
    executors.push(
      new ClaudeCodeExecutor({
        binary: config.executors.claudeCode.binary,
        defaultModel: config.executors.claudeCode.defaultModel,
      })
    );
  }

  return executors;
}

export function selectExecutor(executors: Executor[], _preferredModel?: string): Executor | null {
  if (executors.length === 0) {
    return null;
  }

  // Simple selection: use first available
  // In future, could route based on model name patterns
  return executors[0] ?? null;
}
