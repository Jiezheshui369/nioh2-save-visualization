import { createHash } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShareSnapshot } from './privacy';
import { IndexedDbRemoteSnapshotCache, RemoteSnapshotReceiver } from './remoteSnapshotCache';
import type { RemoteCacheScope, RemoteReceiverOptions } from './remoteSnapshotCache';
import { REMOTE_PROTOCOL, remoteSnapshotBytes } from './remoteSyncProtocol';
import type { RemoteSnapshotRequest, RemoteSnapshotResult } from './remoteSyncProtocol';
import type { RelayCiphertext, RemoteDevice, VerifiedRemoteSender } from './remoteSnapshotRouter';
import { loadCachedSnapshot, saveImportedSnapshot } from './snapshotCache';
import type { SaveSnapshot } from './types';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
// In-memory auth/decryption test declarations ONLY. No keys, credentials or network.
const account = { issuer: 'https://issuer.example', subject: 'cache-subject' };
const digest = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const raw = (level = 1): SaveSnapshot => ({ schemaVersion: '1.0.0', snapshotId: 'test-snapshot-' + level,
  game: 'Nioh 2', platform: 'Steam', sourceLastWriteLocal: '2001-02-03T00:00:00Z',
  safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalMainSaveSha256: 'test-private-hash', originalHashUnchangedAfterProcessing: true },
  character: { level, amrita: 0, gold: 0, attributes: { constitution: 1, heart: 2, courage: 3, stamina: 4, strength: 5, skill: 6, dexterity: 7, magic: 8 }, proficiency: {} },
  currentLoadout: [], inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, stackedItemRecords: 0, scrollRecordsDetected: 0, equipmentByType: {} }, limitations: [] });
function setup() {
  let time = 1_000_000, counter = 0;
  const devices = new Map<string, RemoteDevice>(['app-1', 'pc-1', 'pc-2'].map(id => [id,
    { id, role: id === 'app-1' ? 'app' : 'pc', account: { ...account }, state: 'active', version: 1, keyId: 'test-reference-' + id }]));
  const opened = new Map<string, { sender: VerifiedRemoteSender; message: RemoteSnapshotResult }>();
  const cache = new IndexedDbRemoteSnapshotCache();
  const options: RemoteReceiverOptions = { enabled: true, issuer: account.issuer, account: { ...account }, appDeviceId: 'app-1',
    directory: { get: id => devices.get(id) ?? null }, cache, now: () => time, sha256: digest,
    security: { openAuthenticated: vi.fn(async frame => { const v = opened.get(frame.requestId); if (!v) throw new Error('test-decrypt-rejected'); return v; }) } };
  const receiver = new RemoteSnapshotReceiver(options); receiver.selectPc('pc-1'); receiver.setOnline(true);
  const scope = (pcDeviceId = 'pc-1'): RemoteCacheScope => ({ account: { ...account }, appDeviceId: 'app-1', pcDeviceId });
  async function message(publicationVersion = 1, level = 1, pc = 'pc-1', notModified?: RemoteSnapshotResult) {
    time++;
    const request: RemoteSnapshotRequest = { protocol: REMOTE_PROTOCOL, account: { ...account }, requestId: 'request-' + ++counter,
      fromDeviceId: 'app-1', toDeviceId: pc, fromDeviceVersion: 1, toDeviceVersion: devices.get(pc)!.version,
      issuedAt: time, expiresAt: time + 30_000, type: 'snapshot.read', gameId: 'nioh2',
      knownSnapshotId: notModified?.snapshotId ?? null, knownRevision: notModified?.revision ?? null };
    const snapshot = createShareSnapshot(raw(level));
    const result: RemoteSnapshotResult = { ...request, type: 'snapshot.result', fromDeviceId: pc, toDeviceId: 'app-1',
      fromDeviceVersion: request.toDeviceVersion, toDeviceVersion: 1, snapshotId: notModified?.snapshotId ?? snapshot.snapshotId,
      revision: notModified?.revision ?? await digest(remoteSnapshotBytes(snapshot)), publicationVersion,
      outcome: notModified ? 'not-modified' : 'snapshot', snapshot: notModified ? null : snapshot };
    delete (result as unknown as Record<string, unknown>).knownSnapshotId;
    delete (result as unknown as Record<string, unknown>).knownRevision;
    opened.set(request.requestId, { message: result, sender: { account: { ...account }, deviceId: pc,
      deviceVersion: request.toDeviceVersion, keyId: devices.get(pc)!.keyId, authorizationExpiresAt: time + 60_000 } });
    const frame: RelayCiphertext = { protocol: REMOTE_PROTOCOL, requestId: request.requestId, fromDeviceId: pc, toDeviceId: 'app-1', ciphertext: new Uint8Array([2]) };
    return { request, result, frame };
  }
  async function accept(publicationVersion = 1, level = 1) { const m = await message(publicationVersion, level); receiver.beginRequest(m.request); return receiver.receive(m.frame); }
  return { receiver, options, devices, cache, opened, scope, message, accept, advance: (n: number) => { time += n; } };
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe('authenticated remote snapshot atomic cache', () => {
  it('fails closed without security configuration or a private verified capability', async () => {
    const s = setup(), m = await s.message();
    await expect(new RemoteSnapshotReceiver().receive(m.frame)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(new RemoteSnapshotReceiver({ ...s.options, enabled: false }).receive(m.frame)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(s.cache.commit({ request: m.request, result: m.result })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await s.cache.load(s.scope())).toBeNull();
  });
  it('persists snapshot and source/last-sync receipt together while leaving LAN/latest untouched', async () => {
    const legacy = raw(90); await saveImportedSnapshot(legacy, { schemaVersion: '1.0.0', source: 'legacy-snapshot', importedAt: '2001-02-04',
      sourceSnapshotId: legacy.snapshotId, sourceLastWriteLocal: legacy.sourceLastWriteLocal, buildCount: 0 });
    const s = setup(), saved = await s.accept(3, 12);
    expect(saved.status).toBe('saved');
    expect(await s.receiver.loadOffline()).toMatchObject({ snapshot: { character: { level: 12 } }, receipt: {
      source: 'remote-relay', account, pcDeviceId: 'pc-1', appDeviceId: 'app-1', publicationVersion: 3, requestId: 'request-1', lastSyncedAt: 1_000_001 } });
    expect(await loadCachedSnapshot()).toEqual(legacy);
  });
  it('makes identical sequential and concurrent replies idempotent without advancing last-sync', async () => {
    const s = setup(), m = await s.message(); s.receiver.beginRequest(m.request);
    const first = await s.receiver.receive(m.frame); s.advance(10);
    expect(await s.receiver.receive(m.frame)).toEqual({ status: 'duplicate', receipt: first.receipt });
    const next = await s.message(2, 2); s.receiver.beginRequest(next.request);
    const both = await Promise.all([s.receiver.receive(next.frame), s.receiver.receive(next.frame)]);
    expect(both.map(x => x.status).sort()).toEqual(['duplicate', 'saved']);
    expect(both[0].receipt).toEqual(both[1].receipt);
  });
  it('retains newer publication for concurrent requests completed in reverse order', async () => {
    const s = setup(), slow = await s.message(2, 2); s.receiver.beginRequest(slow.request);
    const fast = await s.message(3, 3); s.receiver.beginRequest(fast.request);
    const delay = deferred<string>(); s.options.sha256 = vi.fn(async bytes => bytes.length ? digest(bytes) : '');
    // Decrypt delay exercises actual receiver and serialized read/write transactions.
    const original = s.options.security.openAuthenticated;
    s.options.security.openAuthenticated = async frame => { if (frame.requestId === slow.request.requestId) await delay.promise; return original(frame); };
    const earlier = s.receiver.receive(slow.frame);
    expect((await s.receiver.receive(fast.frame)).status).toBe('saved'); delay.resolve('ready');
    expect((await earlier).status).toBe('ignored-stale');
    expect((await s.receiver.loadOffline())?.snapshot.character.level).toBe(3);
  });
  it('rejects a different authenticated result reusing a completed request ID', async () => {
    const s = setup(), m = await s.message(); s.receiver.beginRequest(m.request); await s.receiver.receive(m.frame);
    const before = await s.receiver.loadOffline(), replacement = createShareSnapshot(raw(2));
    Object.assign(m.result, { snapshot: replacement, snapshotId: replacement.snapshotId, publicationVersion: 2,
      revision: await digest(remoteSnapshotBytes(replacement)) });
    await expect(s.receiver.receive(m.frame)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    expect(await s.receiver.loadOffline()).toEqual(before);
  });
  it('does not order SHA hashes or source save dates; requires monotonic publication versions', async () => {
    const s = setup(); await s.accept(5, 5);
    expect((await s.accept(4, 100)).status).toBe('ignored-stale');
    const conflict = await s.message(5, 200); s.receiver.beginRequest(conflict.request);
    await expect(s.receiver.receive(conflict.frame)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    expect((await s.receiver.loadOffline())?.snapshot.character.level).toBe(5);
  });
  it('isolates two PCs in one account even with equal snapshot IDs and revisions', async () => {
    const s = setup(); await s.accept(100, 1); const first = await s.receiver.loadOffline();
    s.receiver.selectPc('pc-2'); const m = await s.message(1, 1, 'pc-2'); s.receiver.beginRequest(m.request);
    expect((await s.receiver.receive(m.frame)).status).toBe('saved');
    expect((await s.receiver.loadOffline())?.receipt).toMatchObject({ pcDeviceId: 'pc-2', publicationVersion: 1 });
    expect(await s.cache.load(s.scope('pc-1'))).toEqual(first);
    expect(await s.cache.load({ ...s.scope(), account: { ...account, subject: 'other' } })).toBeNull();
  });
  it('never reuses another PCs cached revision for a not-modified result', async () => {
    const s = setup(); await s.accept(); const prior = await s.message();
    s.receiver.selectPc('pc-2'); const m = await s.message(1, 1, 'pc-2', prior.result); s.receiver.beginRequest(m.request);
    await expect(s.receiver.receive(m.frame)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await s.cache.load(s.scope('pc-2'))).toBeNull(); expect(await s.cache.load(s.scope())).not.toBeNull();
  });
  it('records confirmation time only after a successful same-source not-modified transaction', async () => {
    const s = setup(); const first = await s.message(); s.receiver.beginRequest(first.request); await s.receiver.receive(first.frame);
    s.advance(100); const next = await s.message(1, 1, 'pc-1', first.result); s.receiver.beginRequest(next.request);
    const saved = await s.receiver.receive(next.frame);
    expect(saved.status).toBe('confirmed'); expect(saved.receipt.lastSyncedAt).toBe(1_000_102);
    expect((await s.receiver.loadOffline())?.snapshot.character.level).toBe(1);
  });
  it.each(['schema', 'checksum', 'account', 'device', 'expiry', 'decrypt'] as const)('preserves old record after %s failure', async kind => {
    const s = setup(); await s.accept(); const before = await s.receiver.loadOffline();
    const m = await s.message(2, 2); s.receiver.beginRequest(m.request);
    if (kind === 'schema') m.result.snapshot!.character.attributes = {} as SaveSnapshot['character']['attributes'];
    if (kind === 'checksum') m.result.snapshot!.character.level++;
    if (kind === 'account') s.opened.get(m.request.requestId)!.sender.account.subject = 'different';
    if (kind === 'device') s.devices.get('pc-1')!.state = 'revoked';
    if (kind === 'expiry') s.advance(30_001);
    if (kind === 'decrypt') s.opened.delete(m.request.requestId);
    await expect(s.receiver.receive(m.frame)).rejects.toThrow(); expect(await s.cache.load(s.scope())).toEqual(before);
  });
  it.each(['offline', 'pc-switch', 'logout'] as const)('cancels a response during decryption after %s', async kind => {
    const s = setup(); await s.accept(); const before = await s.receiver.loadOffline();
    const m = await s.message(2, 2); s.receiver.beginRequest(m.request);
    const pending = deferred<{ sender: VerifiedRemoteSender; message: RemoteSnapshotResult }>(); s.options.security.openAuthenticated = () => pending.promise;
    const result = s.receiver.receive(m.frame), failed = expect(result).rejects.toThrow();
    if (kind === 'offline') s.receiver.setOnline(false);
    if (kind === 'pc-switch') s.receiver.selectPc('pc-2');
    if (kind === 'logout') s.receiver.deactivate();
    pending.resolve(s.opened.get(m.request.requestId)!); await failed;
    expect(await s.cache.load(s.scope())).toEqual(before);
  });
  it('rolls back both snapshot and receipt on quota failure, then permits a verified retry', async () => {
    const s = setup(); await s.accept(); const before = await s.receiver.loadOffline();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('test-quota', 'QuotaExceededError'); });
    await expect(s.accept(2, 2)).rejects.toMatchObject({ code: 'STORAGE' }); put.mockRestore();
    expect(await s.receiver.loadOffline()).toEqual(before); expect((await s.accept(3, 3)).status).toBe('saved');
  });
  it('aborts an already staged write on revocation notification without partial receipt changes', async () => {
    const s = setup(); await s.accept(); const before = await s.receiver.loadOffline(), original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const req = original.call(this, value, key); req.addEventListener('success', () => { s.devices.get('pc-1')!.state = 'revoked'; s.receiver.invalidate(); }); return req;
    });
    await expect(s.accept(2, 2)).rejects.toThrow(); put.mockRestore();
    expect(await s.cache.load(s.scope())).toEqual(before);
  });
  it('loads committed data after receiver reconstruction and network loss', async () => {
    const s = setup(); await s.accept(7, 7); const second = new RemoteSnapshotReceiver(s.options); second.selectPc('pc-1');
    expect((await second.loadOffline())?.snapshot.character.level).toBe(7);
    await expect(second.receive((await s.message()).frame)).rejects.toThrow();
    expect((await second.loadOffline())?.receipt.publicationVersion).toBe(7);
  });
});
