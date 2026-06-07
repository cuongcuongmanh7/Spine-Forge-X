import { describe, expect, it } from 'vitest';
import { computeCanStart, statusFromValidation } from './validation';
import { defaultSessionConfig, type Session, type SessionConfig } from './config';
import type { ValidateResult } from './types';

function makeSession(config: Partial<SessionConfig> = {}): Session {
  return {
    id: 's1',
    projectId: 'p1',
    name: 'Test',
    autoNamed: false,
    wizardCompleted: true,
    config: { ...defaultSessionConfig, ...config },
    createdAt: 0,
    updatedAt: 0
  };
}

function result(over: Partial<ValidateResult> = {}): ValidateResult {
  return { ok: true, warnings: [], errors: [], ...over };
}

describe('computeCanStart', () => {
  const ready = {
    validationOk: true,
    fileCount: 3,
    globalJsonPath: 'C:/preset.export.json',
    anyRunning: false,
    activeSessionId: 's1'
  };

  it('is true only when every precondition holds', () => {
    expect(computeCanStart(ready)).toBe(true);
  });

  it('is false when any single precondition fails', () => {
    expect(computeCanStart({ ...ready, validationOk: false })).toBe(false);
    expect(computeCanStart({ ...ready, fileCount: 0 })).toBe(false);
    expect(computeCanStart({ ...ready, globalJsonPath: '   ' })).toBe(false);
    expect(computeCanStart({ ...ready, anyRunning: true })).toBe(false);
    expect(computeCanStart({ ...ready, activeSessionId: null })).toBe(false);
  });

  it('treats a whitespace-only preset path as not configured', () => {
    expect(computeCanStart({ ...ready, globalJsonPath: '' })).toBe(false);
  });
});

describe('statusFromValidation (Property 15: sidebar & main panel agree)', () => {
  const configured: Partial<SessionConfig> = {
    inputPath: 'C:/in',
    globalJsonPath: 'C:/preset.export.json'
  };

  it('is green when valid, configured, with files and no warnings', () => {
    expect(statusFromValidation(makeSession(configured), result(), 2)).toBe('green');
  });

  it('is yellow when valid + has files but warnings present', () => {
    expect(statusFromValidation(makeSession(configured), result({ warnings: ['heads up'] }), 2)).toBe('yellow');
  });

  it('is red when validation failed', () => {
    expect(statusFromValidation(makeSession(configured), result({ ok: false }), 2)).toBe('red');
  });

  it('is red when no input is configured', () => {
    expect(statusFromValidation(makeSession({ globalJsonPath: 'C:/p.export.json' }), result(), 2)).toBe('red');
  });

  it('is red when no global preset is configured', () => {
    expect(statusFromValidation(makeSession({ inputPath: 'C:/in' }), result(), 2)).toBe('red');
  });

  it('is red when input is set but the scan found zero files', () => {
    expect(statusFromValidation(makeSession(configured), result(), 0)).toBe('red');
  });

  it('counts inputFiles (not just inputPath) as configured input', () => {
    const viaFiles = makeSession({ inputFiles: ['a.spine'], globalJsonPath: 'C:/p.export.json' });
    expect(statusFromValidation(viaFiles, result(), 1)).toBe('green');
  });
});
