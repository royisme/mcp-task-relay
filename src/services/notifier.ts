/**
 * Notifier service
 * Handles all notifications (MCP resources, webhooks, etc.)
 */

import type { Logger } from 'pino';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type {
  JobId,
  JobState,
  ResourceUpdatedNotification,
  JobFinishedNotification,
} from '../models/index.js';

export type NotificationListener = (notification: unknown) => void;

export class Notifier {
  private listeners: Set<NotificationListener> = new Set();

  constructor(
    private readonly mcpServer: Server | null,
    private readonly logger: Logger
  ) {}

  addListener(listener: NotificationListener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: NotificationListener): void {
    this.listeners.delete(listener);
  }

  async notifyResourceUpdated(uri: string, stateVersion: number): Promise<void> {
    const notification: ResourceUpdatedNotification = {
      uri,
      stateVersion,
    };

    // Notify MCP clients
    if (this.mcpServer) {
      try {
        await this.mcpServer.notification({
          method: 'notifications/resources/updated',
          params: notification,
        });
      } catch (error) {
        this.logger.warn({ error, uri }, 'Failed to send MCP notification');
      }
    }

    // Notify local listeners (for UI, etc.)
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch (error) {
        this.logger.warn({ error }, 'Listener error');
      }
    }
  }

  async notifyJobFinished(
    jobId: JobId,
    state: Extract<JobState, 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'EXPIRED'>,
    details: {
      summary: string;
      artifacts: {
        patch?: string;
        out?: string;
        logs?: string;
        pr?: string;
      };
      stateVersion: number;
      reasonCode?: string;
      startedAt?: number;
      finishedAt?: number;
      durationMs?: number;
      attempt: number;
    }
  ): Promise<void> {
    const notification: JobFinishedNotification = {
      jobId,
      state,
      summary: details.summary,
      artifacts: details.artifacts,
      stateVersion: details.stateVersion,
      reasonCode: details.reasonCode as JobFinishedNotification['reasonCode'],
      startedAt: details.startedAt,
      finishedAt: details.finishedAt,
      durationMs: details.durationMs,
      attempt: details.attempt,
    };

    const method =
      state === 'SUCCEEDED' ? 'notifications/job/finished' : 'notifications/job/failed';

    // Notify MCP clients
    if (this.mcpServer) {
      try {
        await this.mcpServer.notification({
          method,
          params: notification,
        });
      } catch (error) {
        this.logger.warn({ error, jobId }, 'Failed to send job notification');
      }
    }

    // Notify local listeners
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch (error) {
        this.logger.warn({ error }, 'Listener error');
      }
    }

    this.logger.info({ jobId, state }, 'Job notification sent');
  }
}
