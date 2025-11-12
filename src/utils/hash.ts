/**
 * Hashing utilities
 */

import { createHash } from 'crypto';
import type { JobSpec, ContextEnvelope } from '../models/index.js';

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

/**
 * Create a stable, deterministic SHA-256 hash of a context envelope.
 * Uses JSON canonicalization to ensure identical contexts produce identical hashes.
 */
export function stableHashContext(envelope: ContextEnvelope): string {
  // Recursively sort object keys for deterministic serialization
  const canonicalize = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(canonicalize);
    }
    if (typeof obj === 'object') {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(obj).sort();
      for (const key of keys) {
        sorted[key] = canonicalize((obj as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return obj;
  };

  const canonical = canonicalize(envelope);
  const content = JSON.stringify(canonical);
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
