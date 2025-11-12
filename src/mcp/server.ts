/**
 * MCP Server implementation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import type { JobManager } from '../core/job-manager.js';
import type { ArtifactsService } from '../services/artifacts.js';
import type { Notifier } from '../services/notifier.js';
import {
  SubmitRequestSchema,
  GetRequestSchema,
  ListRequestSchema,
  CancelRequestSchema,
} from '../models/schemas.js';
import { asJobId } from '../models/index.js';
import type { ArtifactKind } from '../models/index.js';

export class JobHubMCPServer {
  private readonly server: Server;

  constructor(
    private readonly jobManager: JobManager,
    private readonly artifacts: ArtifactsService,
    _notifier: Notifier,
    private readonly logger: Logger
  ) {
    this.server = new Server(
      {
        name: 'mcp-task-relay',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {
            subscribe: true,
          },
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'jobs_submit',
          description: 'Submit a new job to the queue',
          inputSchema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                description: 'Job specification',
              },
            },
            required: ['spec'],
          },
        },
        {
          name: 'jobs_get',
          description: 'Get job status and details',
          inputSchema: {
            type: 'object',
            properties: {
              jobId: { type: 'string', description: 'Job ID' },
            },
            required: ['jobId'],
          },
        },
        {
          name: 'jobs_list',
          description: 'List jobs with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              state: { type: 'string', description: 'Filter by state' },
              limit: { type: 'number', description: 'Max results', default: 20 },
              offset: { type: 'number', description: 'Offset for pagination', default: 0 },
            },
          },
        },
        {
          name: 'jobs_cancel',
          description: 'Cancel a running or queued job',
          inputSchema: {
            type: 'object',
            properties: {
              jobId: { type: 'string', description: 'Job ID to cancel' },
            },
            required: ['jobId'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'jobs_submit': {
          const parsed = SubmitRequestSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments: ${parsed.error.message}`);
          }

          const result = await this.jobManager.submit(parsed.data.spec);
          if (!result.ok) {
            throw new Error(result.error);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result.value, null, 2),
              },
            ],
          };
        }

        case 'jobs_get': {
          const parsed = GetRequestSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments: ${parsed.error.message}`);
          }

          const result = this.jobManager.get(asJobId(parsed.data.jobId));
          if (!result.ok) {
            throw new Error(result.error);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result.value, null, 2),
              },
            ],
          };
        }

        case 'jobs_list': {
          const parsed = ListRequestSchema.safeParse(args ?? {});
          if (!parsed.success) {
            throw new Error(`Invalid arguments: ${parsed.error.message}`);
          }

          const result = this.jobManager.list(
            parsed.data.state,
            parsed.data.limit,
            parsed.data.offset
          );
          if (!result.ok) {
            throw new Error(result.error);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result.value, null, 2),
              },
            ],
          };
        }

        case 'jobs_cancel': {
          const parsed = CancelRequestSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments: ${parsed.error.message}`);
          }

          const result = this.jobManager.cancel(asJobId(parsed.data.jobId));
          if (!result.ok) {
            throw new Error(result.error);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result.value, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'mcp://jobs/list',
          name: 'Job List',
          description: 'List of all jobs',
          mimeType: 'application/json',
        },
      ],
    }));

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      // Parse URI
      const match = /^mcp:\/\/jobs\/(.+?)\/(.+)$/.exec(uri);
      if (!match) {
        // Handle list endpoint
        if (uri === 'mcp://jobs/list') {
          const result = this.jobManager.list(undefined, 100, 0);
          if (!result.ok) {
            throw new Error(result.error);
          }

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(result.value, null, 2),
              },
            ],
          };
        }

        throw new Error(`Invalid resource URI: ${uri}`);
      }

      const jobId = asJobId(match[1] ?? '');
      const resource = match[2] ?? '';

      if (resource === 'status') {
        const result = this.jobManager.getStatus(jobId);
        if (!result.ok) {
          throw new Error(result.error);
        }

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(result.value, null, 2),
            },
          ],
        };
      }

      // Handle artifacts
      const artifactMatch = /^artifacts\/(.+)$/.exec(resource);
      if (artifactMatch) {
        const kind = artifactMatch[1] as ArtifactKind;
        const result = await this.artifacts.read(jobId, kind);
        if (!result.ok) {
          throw new Error(result.error);
        }

        return {
          contents: [
            {
              uri,
              mimeType: kind.endsWith('.md') ? 'text/markdown' : 'text/plain',
              text: result.value,
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${resource}`);
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('MCP server started');
  }

  getServer(): Server {
    return this.server;
  }
}
