import { describe, expect, it } from 'vitest';
import { validateAgentStatus, validateSaveSources } from './agentStatus';

const status = { status: 'ok', writeBackSupported: false, refreshAvailable: true, lanMode: false };
const source = { id: 'source-1', accountHint: '…0000', slot: 'SAVEDATA00', latestWriteLocal: null, active: true };
describe('agent metadata boundary', () => {
  it('accepts minimal older health responses without inventing granted capabilities', () => {
    expect(validateAgentStatus({ status: 'ok', writeBackSupported: false })).toEqual({ ...status, refreshAvailable: false });
  });
  it.each([null, [], {}, { ...status, status: 'error' }, { ...status, writeBackSupported: true },
    { ...status, refreshAvailable: 'true' }, { ...status, lanMode: 1 }, { ...status, apiVersion: {} },
    { ...status, source: { configured: true, accountHint: null, saveSlots: {}, latestWriteLocal: null } },
    { ...status, backupCopies: { completeCopies: -1, incompleteCopies: 0, latestCreatedAtUtc: null } },
    { ...status, steamCloud: { detected: true, state: ['synchronized'], lastRemoteWriteLocal: null, metadataLastWriteLocal: null } },
    { ...status, steamCloud: { detected: true, state: 'synchronized', lastRemoteWriteLocal: {}, metadataLastWriteLocal: null } },
  ])('rejects unsafe health metadata: %j', value => expect(() => validateAgentStatus(value)).toThrow());
  it('accepts complete known cloud and backup metadata', () => {
    const value = { ...status, source: { configured: false, accountHint: null, saveSlots: [], latestWriteLocal: null },
      backupCopies: { completeCopies: 2, incompleteCopies: 0, latestCreatedAtUtc: '2026-09-25T00:00:00Z' },
      steamCloud: { detected: true, state: 'unknown', lastRemoteWriteLocal: null, metadataLastWriteLocal: null, sizeMatches: false, contentMatches: null } };
    expect(validateAgentStatus(value)).toEqual(value);
  });
  it('projects only safe source metadata', () => {
    expect(validateSaveSources([{ ...source, privatePath: 'ignored' }])).toEqual([source]);
  });
  it.each([null, {}, [null], [source, source], [{ ...source, id: '' }], [{ ...source, accountHint: {} }],
    [{ ...source, slot: [] }], [{ ...source, latestWriteLocal: 'invalid' }], [{ ...source, active: 1 }]])(
    'rejects invalid or ambiguous source lists: %j', value => expect(() => validateSaveSources(value)).toThrow('来源列表无效'));
});
