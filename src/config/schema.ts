/**
 * Configuration schema with validation
 */

import { z } from 'zod';

export const ConfigSchema = z.object({
  runtime: z.object({
    profile: z.enum(['dev', 'staging', 'prod']).default('dev'),
    transport: z.enum(['stdio']).default('stdio'),
    promptsDir: z.string().optional(),
    schemataDir: z.string().optional(),
    policyFile: z.string().optional(),
  }),

  server: z.object({
    artifactRoot: z.string().default('./artifacts'),
    maxConcurrency: z.number().int().positive().default(3),
    heartbeatIntervalSec: z.number().int().positive().default(15),
    leaseTtlSec: z.number().int().positive().default(60),
    workerPollIntervalMs: z.number().int().positive().default(5000),
    jobTimeoutCheckIntervalMs: z.number().int().positive().default(30000),
  }),

  askAnswer: z.object({
    port: z.number().int().positive().default(3415),
    longPollTimeoutSec: z.number().int().positive().max(60).default(25),
    sseHeartbeatSec: z.number().int().positive().max(60).default(10),
  }),

  storage: z.object({
    mode: z.enum(['memory', 'sqlite']).default('memory'),
    sqlitePath: z.string().optional(),
  }),

  policies: z.object({
    generation: z.object({
      sandbox: z.literal('read-only').default('read-only'),
      askPolicy: z.literal('untrusted').default('untrusted'),
      requireSections: z.array(z.string()).default(['DIFF', 'TEST_PLAN', 'NOTES']),
    }),
  }),

  executors: z.object({
    codexCli: z.object({
      enabled: z.boolean().default(true),
      binary: z.string().default('codex'),
      defaultModel: z.string().default('gpt-4'),
      enableSearch: z.boolean().default(true),
    }),
    claudeCode: z.object({
      enabled: z.boolean().default(false),
      binary: z.string().default('claude'),
      defaultModel: z.string().default('claude-sonnet-4'),
    }),
  }),

  notify: z.object({
    useMcpResourceSubscriptions: z.boolean().default(true),
    webhook: z.string().url().optional(),
    enablePr: z.boolean().default(false),
  }),

  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    pretty: z.boolean().default(true),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
