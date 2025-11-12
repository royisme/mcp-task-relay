import { describe, expect, test } from 'bun:test';
import { ask } from '../src/sdk/executor.js';

describe('Executor SDK ask()', () => {
  test('includes role_id in Ask payload and returns answer JSON', async () => {
    const originalFetch = globalThis.fetch;
    let postedBody: any;

    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/asks') && init?.method === 'POST') {
        postedBody = JSON.parse((init.body as string) ?? '{}');
        return new Response(JSON.stringify({ askId: postedBody.ask_id }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/answer')) {
        return new Response(
          JSON.stringify({
            askId: postedBody.ask_id,
            jobId: postedBody.job_id,
            stepId: postedBody.step_id,
            status: 'ANSWERED',
            answerText: 'ok',
            answerJson: { ok: true },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    }) as typeof fetch;

    process.env['TASK_RELAY_JOB_ID'] = 'job_123';
    process.env['TASK_RELAY_STEP_ID'] = 'step-1';
    process.env['TASK_RELAY_CONTEXT_HASH'] = 'ctx-abc';
    process.env['ASK_ANSWER_ORIGIN'] = 'http://scheduler.local';

    try {
      const result = await ask('RESOURCE_FETCH', 'Return JSON array of columns.', {
        allowed_tools: ['repo.read'],
        role_id: 'role.schema_summarizer',
      });

      expect(result.json).toEqual({ ok: true });
      expect(postedBody.role_id).toBe('role.schema_summarizer');
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env['TASK_RELAY_JOB_ID'];
      delete process.env['TASK_RELAY_STEP_ID'];
      delete process.env['TASK_RELAY_CONTEXT_HASH'];
      delete process.env['ASK_ANSWER_ORIGIN'];
    }
  });
});
