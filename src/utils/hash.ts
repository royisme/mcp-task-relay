/**
 * Hashing utilities
 */

import { createHash } from 'crypto';
import type { JobSpec } from '../models/index.js';

export function hashJobSpec(spec: JobSpec): string {
  // Create deterministic hash of job spec
  const normalized = {
    repo: spec.repo,
    task: spec.task,
    scope: spec.scope,
    context: spec.context,
    execution: {
      ...spec.execution,
      // Exclude non-deterministic fields
      timeoutS: undefined,
    },
  };

  const content = JSON.stringify(normalized, Object.keys(normalized).sort());
  return createHash('sha256').update(content).digest('hex');
}

export function generateJobId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `job_${timestamp}_${random}`;
}
