import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEPARATOR,
  assertValidKey,
  assertValidSegment,
  assertValidSeparator,
  createKeyCodec,
  isReservedKey,
} from '../src/namespace/key.js';
import { InvalidKeyError, InvalidNamespaceError, InvalidOptionsError } from '../src/errors.js';

describe('segment validation', () => {
  it('accepts the documented character set', () => {
    for (const segment of ['basket', 'team-checkout', 'my_app', 'v1.2', 'A0']) {
      expect(() => assertValidSegment(segment, 'namespace')).not.toThrow();
    }
  });

  it('rejects empty and non-string segments', () => {
    expect(() => assertValidSegment('', 'namespace')).toThrow(InvalidNamespaceError);
    expect(() => assertValidSegment(undefined as unknown as string, 'namespace')).toThrow(
      InvalidNamespaceError,
    );
  });

  it('rejects a segment containing the separator, which would make keys ambiguous', () => {
    expect(() => assertValidSegment('bas:ket', 'namespace')).toThrow(InvalidNamespaceError);
    expect(() => assertValidSegment('bas ket', 'namespace')).toThrow(/outside \[A-Za-z0-9_\.-\]/);
  });
});

describe('separator validation', () => {
  it('accepts separators built from characters a segment may not contain', () => {
    for (const separator of [':', '::', '/', '|']) {
      expect(() => assertValidSeparator(separator)).not.toThrow();
    }
  });

  it('rejects a separator that could legally appear inside a segment', () => {
    // "v1.2" is a legal namespace, so "." cannot also mean "boundary".
    expect(() => assertValidSeparator('.')).toThrow(InvalidOptionsError);
    expect(() => assertValidSeparator('-')).toThrow(InvalidOptionsError);
    expect(() => assertValidSeparator('')).toThrow(InvalidOptionsError);
  });
});

describe('key validation', () => {
  it('rejects empty keys', () => {
    expect(() => assertValidKey('', 'basket')).toThrow(InvalidKeyError);
  });

  it('rejects the reserved prefix', () => {
    expect(() => assertValidKey('__nss:meta', 'basket')).toThrow(/reserved/);
    expect(isReservedKey('__nssanything')).toBe(true);
    expect(isReservedKey('count')).toBe(false);
  });
});

describe('key codec', () => {
  it('encodes and decodes with the default separator', () => {
    const codec = createKeyCodec({ segments: ['basket'] });
    expect(codec.fullPrefix).toBe(`basket${DEFAULT_SEPARATOR}`);
    expect(codec.encode('count')).toBe('basket:count');
    expect(codec.decode('basket:count')).toBe('count');
  });

  it('returns null for keys belonging to another namespace', () => {
    const codec = createKeyCodec({ segments: ['basket'] });
    expect(codec.decode('auth:token')).toBeNull();
    expect(codec.decode('count')).toBeNull();
    // A namespace that merely starts with the same letters must not match.
    expect(codec.decode('basketball:count')).toBeNull();
  });

  it('round-trips a user key that itself contains the separator', () => {
    const codec = createKeyCodec({ segments: ['basket'] });
    const key = 'nested:deep:key';
    expect(codec.decode(codec.encode(key))).toBe(key);
  });

  it('chains prefix, namespace and children', () => {
    const codec = createKeyCodec({ segments: ['myapp', 'basket', 'ui'] });
    expect(codec.path).toBe('myapp:basket:ui');
    expect(codec.encode('collapsed')).toBe('myapp:basket:ui:collapsed');
  });

  it('honours a custom separator', () => {
    const codec = createKeyCodec({ segments: ['basket'], separator: '/' });
    expect(codec.encode('count')).toBe('basket/count');
    expect(codec.decode('basket/count')).toBe('count');
  });
});
