/**
 * State machine definitions for job lifecycle
 */

// Job states
export const JobStates = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  WAITING_ON_ANSWER: 'WAITING_ON_ANSWER',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
  EXPIRED: 'EXPIRED',
  STALE: 'STALE', // Lost heartbeat
} as const;

export type JobState = (typeof JobStates)[keyof typeof JobStates];

// Terminal states
export type TerminalState = Extract<
  JobState,
  'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'EXPIRED'
>;

export function isTerminalState(state: JobState): state is TerminalState {
  return (
    state === 'SUCCEEDED' ||
    state === 'FAILED' ||
    state === 'CANCELED' ||
    state === 'EXPIRED'
  );
}

// Failure reason codes
export const FailReasons = {
  BAD_ARTIFACTS: 'BAD_ARTIFACTS', // Output parsing failed
  CONFLICT: 'CONFLICT', // Git apply failed
  POLICY: 'POLICY', // Security/policy violation
  EXECUTOR_ERROR: 'EXECUTOR_ERROR', // Executor crashed
  TIMEOUT: 'TIMEOUT', // Exceeded time limit
  INTERNAL_ERROR: 'INTERNAL_ERROR', // System error
} as const;

// Ask/Answer error codes
export const AskAnswerErrors = {
  E_CONTEXT_MISMATCH: 'E_CONTEXT_MISMATCH', // Context hash verification failed
  E_CAPS_VIOLATION: 'E_CAPS_VIOLATION', // Tool capability violation
  E_NO_CONTEXT_ENVELOPE: 'E_NO_CONTEXT_ENVELOPE', // Missing required context envelope
} as const;

export type AskAnswerError = (typeof AskAnswerErrors)[keyof typeof AskAnswerErrors];

export type FailReason = (typeof FailReasons)[keyof typeof FailReasons];

// Priority levels
export const Priorities = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
} as const;

export type Priority = (typeof Priorities)[keyof typeof Priorities];

export function priorityToNumber(priority: Priority): number {
  switch (priority) {
    case 'P0':
      return 0;
    case 'P1':
      return 1;
    case 'P2':
      return 2;
    default:
      assertNever(priority);
  }
}

// Exhaustiveness checking
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

// State transition validation
export function canTransition(from: JobState, to: JobState): boolean {
  // Terminal states can't transition
  if (isTerminalState(from)) {
    return false;
  }

  switch (from) {
    case 'QUEUED':
      return to === 'RUNNING' || to === 'CANCELED' || to === 'EXPIRED';
    case 'RUNNING':
      return (
        to === 'SUCCEEDED' ||
        to === 'FAILED' ||
        to === 'CANCELED' ||
        to === 'EXPIRED' ||
        to === 'STALE' ||
        to === 'WAITING_ON_ANSWER'
      );
    case 'WAITING_ON_ANSWER':
      return (
        to === 'RUNNING' ||
        to === 'FAILED' ||
        to === 'CANCELED' ||
        to === 'EXPIRED'
      );
    case 'STALE':
      return to === 'RUNNING' || to === 'FAILED' || to === 'EXPIRED';
    default:
      assertNever(from);
  }
}
