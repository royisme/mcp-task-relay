/**
 * Branded types to prevent string mixing
 * Using nominal typing pattern for type safety
 */

declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & { readonly [brand]: TBrand };

// Core branded types
export type JobId = Brand<string, 'JobId'>;
export type AttemptId = Brand<string, 'AttemptId'>;
export type LeaseOwner = Brand<string, 'LeaseOwner'>;
export type CommitHash = Brand<string, 'CommitHash'>;

// Resource URIs with template literal types
export type ResourceURI =
  | `mcp://jobs/${JobId}/status`
  | `mcp://jobs/${JobId}/artifacts/patch.diff`
  | `mcp://jobs/${JobId}/artifacts/out.md`
  | `mcp://jobs/${JobId}/artifacts/logs.txt`
  | `mcp://jobs/${JobId}/artifacts/pr.json`;

// Type guards for branded types
export function isJobId(value: unknown): value is JobId {
  return typeof value === 'string' && value.length > 0;
}

export function asJobId(value: string): JobId {
  if (!isJobId(value)) {
    throw new Error(`Invalid JobId: ${value}`);
  }
  return value as JobId;
}

export function asLeaseOwner(value: string): LeaseOwner {
  return value as LeaseOwner;
}

export function asCommitHash(value: string): CommitHash {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(`Invalid commit hash: ${value}`);
  }
  return value as CommitHash;
}

// URI factory functions
export function makeStatusURI(jobId: JobId): ResourceURI {
  return `mcp://jobs/${jobId}/status` as ResourceURI;
}

export function makeArtifactURI(
  jobId: JobId,
  artifact: 'patch.diff' | 'out.md' | 'logs.txt' | 'pr.json'
): ResourceURI {
  return `mcp://jobs/${jobId}/artifacts/${artifact}` as ResourceURI;
}
