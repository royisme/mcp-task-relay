/**
 * Logger utility using pino
 */

import pino from 'pino';
import type { Logger } from 'pino';

export function createLogger(config: { level: string; pretty: boolean }): Logger {
  if (config.pretty) {
    return pino({
      level: config.level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino({
    level: config.level,
  });
}

export type { Logger };
