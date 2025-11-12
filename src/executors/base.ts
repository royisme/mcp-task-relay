/**
 * Base executor interface
 */

import type { JobSpec } from '../models/index.js';
import type { Result } from '../models/index.js';

export interface ExecutorOutput {
  diff: string;
  testPlan: string;
  notes: string;
  rawOutput: string;
}

export interface ExecutorContext {
  workDir: string;
  timeoutMs?: number;
}

export interface Executor {
  readonly name: string;
  execute(spec: JobSpec, context: ExecutorContext): Promise<Result<ExecutorOutput, string>>;
}
