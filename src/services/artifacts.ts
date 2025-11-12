/**
 * Artifact management service
 * Handles file storage and retrieval
 */

import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import type { JobId } from '../models/index.js';
import type { ArtifactKind } from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';
import { makeArtifactURI } from '../models/index.js';

export interface ArtifactContent {
  content: string;
  digest: string;
  size: number;
}

export class ArtifactsService {
  constructor(private readonly artifactRoot: string) {}

  private getArtifactPath(jobId: JobId, kind: ArtifactKind): string {
    return join(this.artifactRoot, jobId, kind);
  }

  async ensureJobDirectory(jobId: JobId): Promise<Result<void, string>> {
    try {
      const jobDir = join(this.artifactRoot, jobId);
      await mkdir(jobDir, { recursive: true });
      return Ok(undefined);
    } catch (error) {
      return Err(`Failed to create job directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async write(
    jobId: JobId,
    kind: ArtifactKind,
    content: string
  ): Promise<Result<ArtifactContent, string>> {
    try {
      // Ensure directory exists
      const dirResult = await this.ensureJobDirectory(jobId);
      if (!dirResult.ok) {
        return dirResult;
      }

      const path = this.getArtifactPath(jobId, kind);
      await writeFile(path, content, 'utf-8');

      // Calculate digest and size
      const digest = createHash('sha256').update(content).digest('hex');
      const size = Buffer.byteLength(content, 'utf-8');

      return Ok({ content, digest, size });
    } catch (error) {
      return Err(`Failed to write artifact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async read(jobId: JobId, kind: ArtifactKind): Promise<Result<string, string>> {
    try {
      const path = this.getArtifactPath(jobId, kind);
      const content = await readFile(path, 'utf-8');
      return Ok(content);
    } catch (error) {
      return Err(`Failed to read artifact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async exists(jobId: JobId, kind: ArtifactKind): Promise<boolean> {
    try {
      const path = this.getArtifactPath(jobId, kind);
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async getSize(jobId: JobId, kind: ArtifactKind): Promise<Result<number, string>> {
    try {
      const path = this.getArtifactPath(jobId, kind);
      const stats = await stat(path);
      return Ok(stats.size);
    } catch (error) {
      return Err(`Failed to get artifact size: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getURI(jobId: JobId, kind: ArtifactKind): string {
    return makeArtifactURI(jobId, kind);
  }
}
