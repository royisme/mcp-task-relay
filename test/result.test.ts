/**
 * Result type tests
 */

import { describe, test, expect } from 'bun:test';
import { Ok, Err, isOk, isErr, unwrap, unwrapOr, mapResult } from '../src/models/result.js';

describe('Result Type', () => {
  test('Ok creates success result', () => {
    const result = Ok(42);
    expect(result.ok).toBe(true);
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test('Err creates error result', () => {
    const result = Err('error message');
    expect(result.ok).toBe(false);
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toBe('error message');
    }
  });

  test('unwrap extracts value from Ok', () => {
    const result = Ok(42);
    expect(unwrap(result)).toBe(42);
  });

  test('unwrap throws on Err', () => {
    const result = Err('error');
    expect(() => unwrap(result)).toThrow();
  });

  test('unwrapOr returns default on Err', () => {
    const result = Err('error');
    expect(unwrapOr(result, 0)).toBe(0);
  });

  test('unwrapOr returns value on Ok', () => {
    const result = Ok(42);
    expect(unwrapOr(result, 0)).toBe(42);
  });

  test('mapResult transforms Ok value', () => {
    const result = Ok(42);
    const mapped = mapResult(result, (x) => x * 2);
    expect(isOk(mapped)).toBe(true);
    if (mapped.ok) {
      expect(mapped.value).toBe(84);
    }
  });

  test('mapResult preserves Err', () => {
    const result = Err('error');
    const mapped = mapResult(result, (x: number) => x * 2);
    expect(isErr(mapped)).toBe(true);
    if (!mapped.ok) {
      expect(mapped.error).toBe('error');
    }
  });
});
