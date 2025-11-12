/**
 * Hash utility tests
 */

import { describe, test, expect } from 'bun:test';
import { hashJobSpec, generateJobId } from '../src/utils/hash.js';

describe('Hash Utilities', () => {
  test('hashJobSpec generates consistent hash', () => {
    const spec = {
      repo: {
        type: 'git' as const,
        url: 'https://github.com/test/repo.git',
        baseBranch: 'main',
        baselineCommit: 'a'.repeat(40),
      },
      task: {
        title: 'Test',
        description: 'Test description',
        acceptance: ['Criterion 1'],
      },
      scope: {
        readPaths: ['src/'],
        disallowReformatting: false,
      },
      context: undefined,
      outputContract: ['DIFF', 'TEST_PLAN', 'NOTES'] as const,
      execution: {
        preferredModel: 'gpt-4',
        sandbox: 'read-only' as const,
        askPolicy: 'untrusted' as const,
        priority: 'P1' as const,
        ttlS: 3600,
      },
      idempotencyKey: 'test-key',
    };

    const hash1 = hashJobSpec(spec);
    const hash2 = hashJobSpec(spec);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA256 hex
  });

  test('generateJobId creates unique IDs', () => {
    const id1 = generateJobId();
    const id2 = generateJobId();
    expect(id1).not.toBe(id2);
    expect(id1).toStartWith('job_');
    expect(id2).toStartWith('job_');
  });
});
