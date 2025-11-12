/**
 * Role Catalog Loader
 * Reads and parses role YAML files from the prompts directory
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'yaml';
import type { Logger } from 'pino';

export interface RoleDefinition {
  id: string;
  version: number;
  purpose: string;
  system: string;
  input_schema?: string;
  output_schema?: string;
  tool_whitelist?: string[];
  limits?: {
    max_tokens?: number;
    max_tool_calls?: number;
  };
  guardrails?: string[];
  examples?: Array<{
    input: unknown;
    output: unknown;
  }>;
}

export class RoleCatalog {
  private readonly cache = new Map<string, RoleDefinition>();

  constructor(
    private readonly promptsDir: string,
    private readonly logger: Logger
  ) {}

  /**
   * Load a role by ID (e.g., "role.diff_planner")
   * Returns null if not found
   */
  load(roleId: string): RoleDefinition | null {
    // Check cache first
    if (this.cache.has(roleId)) {
      return this.cache.get(roleId)!;
    }

    // Try to load from filesystem
    const filePath = this.resolveRolePath(roleId);
    if (!filePath || !existsSync(filePath)) {
      this.logger.warn({ roleId, filePath }, 'Role definition not found');
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = yaml.parse(content) as RoleDefinition;

      // Validate required fields
      if (!parsed.id || !parsed.version || !parsed.system) {
        this.logger.error({ roleId, filePath }, 'Invalid role definition: missing required fields');
        return null;
      }

      // Cache and return
      this.cache.set(roleId, parsed);
      this.logger.debug({ roleId, filePath }, 'Role definition loaded');
      return parsed;
    } catch (error) {
      this.logger.error(
        { roleId, filePath, error: error instanceof Error ? error.message : String(error) },
        'Failed to load role definition'
      );
      return null;
    }
  }

  /**
   * Resolve role ID to file path
   * Supports both with and without @version suffix
   */
  private resolveRolePath(roleId: string): string | null {
    // If role ID already includes @v{N}, use it directly
    if (roleId.includes('@v')) {
      return join(this.promptsDir, `${roleId}.yaml`);
    }

    // Otherwise, try to find the latest version (v1 by default)
    return join(this.promptsDir, `${roleId}@v1.yaml`);
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get default role for a given ask type
   */
  getDefaultRoleForType(askType: string): string | null {
    const defaults: Record<string, string> = {
      CLARIFICATION: 'role.clarifier',
      RESOURCE_FETCH: 'role.finder',
      POLICY_DECISION: 'role.policy_decider',
      APPROVAL: 'role.policy_decider',
      CHOICE: 'role.clarifier',
    };

    return defaults[askType] ?? null;
  }
}
