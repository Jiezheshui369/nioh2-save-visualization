import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopSync, validateSyncStatus } from './mobileSync';
import cases from '../scripts/ios-tests/pairing-cases.json';

const qr = cases.find(row => row.valid)!.qr;
const valid = { enabled: true, devices: 1, urls: [qr], expiresIn: 600, lastSent: null,
  revision: 'a'.repeat(64), publishedSnapshotId: 'test-source', publishedAt: '2026-09-25T00:00:00Z' };
afterEach(() => vi.unstubAllGlobals());

describe('desktop sync status contract', () => {
  it('accepts disabled, previous-version and versioned status', () => {
    expect(validateSyncStatus(valid)).toEqual(valid);
    expect(validateSyncStatus({ enabled: true, devices: 0, urls: [] })).toMatchObject({ enabled: true });
    expect(validateSyncStatus({ enabled: false, devices: 0, urls: [] })).toMatchObject({ enabled: false });
  });

  it.each([
    null, [], {}, { ...valid, enabled: 'true' }, { ...valid, devices: -1 }, { ...valid, devices: 9 },
    { ...valid, devices: 1.5 }, { ...valid, urls: 'text' }, { ...valid, urls: [5] },
    { ...valid, urls: Array(65).fill(qr) }, { ...valid, enabled: false },
    { ...valid, expiresIn: NaN }, { ...valid, expiresIn: -1 }, { ...valid, expiresIn: 601 },
    { ...valid, lastSent: 'bad-date' }, { ...valid, publishedAt: {} },
    { ...valid, publishedSnapshotId: 5 }, { ...valid, publishedSnapshotId: 'x'.repeat(161) },
    { ...valid, revision: ['a'.repeat(64)] }, { ...valid, revision: 'bad' },
  ])('rejects malformed status without using it as UI state', value => {
    expect(() => validateSyncStatus(value)).toThrow('同步状态无效');
  });

  it('rejects unsafe pairing URLs before drawing a QR', () => {
    expect(() => validateSyncStatus({ ...valid, urls: ['https://untrusted.example/'] })).toThrow('配对信息无效');
  });

  it.each([
    [new TypeError('network'), '无法连接电脑同步服务'],
    [new DOMException('timeout', 'TimeoutError'), '结果尚未确认'],
    [new SyntaxError('html'), '未返回有效的同步状态'],
  ])('explains transport failures in Chinese', async (reason, message) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reason));
    await expect(desktopSync('status')).rejects.toThrow(message as string);
  });

  it('rejects successful HTTP with an invalid body and ignores non-text error payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: {} }) }));
    await expect(desktopSync('status')).rejects.toThrow('同步状态无效');
    await expect(desktopSync('publish')).rejects.toThrow('电脑同步服务不可用');
  });
});
