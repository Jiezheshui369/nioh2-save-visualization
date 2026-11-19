import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RemoteSnapshotRouter } from './remoteSnapshotRouter';
import type { RelayCiphertext, RemoteDevice, RemotePublication, RemoteRouterOptions, VerifiedRemoteSender } from './remoteSnapshotRouter';
import { REMOTE_PROTOCOL, parseRemoteSnapshotRequest, parseRemoteSnapshotResult, verifyRemoteSnapshotResult } from './remoteSyncProtocol';
import type { RemoteSnapshotRequest, RemoteSnapshotResult } from './remoteSyncProtocol';
import type { SaveSnapshot } from './types';

// ONLY unit-test doubles. No account/token/key/certificate is created or exported.
const account = { issuer: 'https://issuer.example', subject: 'opaque-subject' };
const now = 10_000;
const request = (): RemoteSnapshotRequest => ({ protocol: REMOTE_PROTOCOL, type: 'snapshot.read', gameId: 'nioh2',
  account: { ...account }, requestId: 'request-1', fromDeviceId: 'app-1', toDeviceId: 'pc-1',
  fromDeviceVersion: 1, toDeviceVersion: 1, issuedAt: now, expiresAt: now + 30_000, knownSnapshotId: null, knownRevision: null });
const snapshot = (): SaveSnapshot => ({ schemaVersion: '1.0.0', snapshotId: 'unit-snapshot', game: 'Nioh 2', platform: 'Steam',
  sourceLastWriteLocal: '2001-02-03T00:00:00Z', safety: { sourceOpenedReadOnly: true, parsedFromCopy: true,
    originalHashUnchangedAfterProcessing: true, originalMainSaveSha256: 'never-export-this-hash' },
  character: { level: 12, amrita: 2, gold: 3, attributes: { constitution: 1, heart: 2, courage: 3, stamina: 4, strength: 5, skill: 6, dexterity: 7, magic: 8 }, proficiency: {} },
  currentLoadout: [], inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, stackedItemRecords: 0, scrollRecordsDetected: 0, equipmentByType: {} }, limitations: [] });
const digest = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function setup() {
  let time = now;
  const devices = new Map<string, RemoteDevice>([
    ['pc-1', { id: 'pc-1', role: 'pc', state: 'active', version: 1, keyId: 'test-pc-key-reference', account: { ...account } }],
    ['app-1', { id: 'app-1', role: 'app', state: 'active', version: 1, keyId: 'test-app-key-reference', account: { ...account } }],
  ]);
  const req = request();
  const sender: VerifiedRemoteSender = { account: { ...account }, deviceId: 'app-1', deviceVersion: 1,
    keyId: 'test-app-key-reference', authorizationExpiresAt: now + 60_000 };
  const frame: RelayCiphertext = { protocol: REMOTE_PROTOCOL, requestId: req.requestId,
    fromDeviceId: req.fromDeviceId, toDeviceId: req.toDeviceId, ciphertext: new Uint8Array([1]) };
  let result: RemoteSnapshotResult | undefined;
  const read = vi.fn(async (): Promise<RemotePublication> => ({ snapshot: snapshot(), publicationVersion: 1 }));
  const seal = vi.fn(async (message: RemoteSnapshotResult): Promise<RelayCiphertext> => {
    result = message; // Assertion capture, not encryption or transport.
    return { protocol: REMOTE_PROTOCOL, requestId: message.requestId, fromDeviceId: message.fromDeviceId,
      toDeviceId: message.toDeviceId, ciphertext: new Uint8Array([2]) };
  });
  const options: RemoteRouterOptions = { enabled: true, issuer: account.issuer, pcDeviceId: 'pc-1',
    directory: { get: id => devices.get(id) ?? null }, security: { openAuthenticated: vi.fn(async () => ({ sender, message: req })), sealAuthenticated: seal },
    readLatestSnapshot: read, sha256: digest, now: () => time };
  const router = new RemoteSnapshotRouter(options);
  router.beginConnect(); router.connected();
  return { router, options, req, frame, sender, devices, read, seal, getResult: () => result!, setTime: (v: number) => { time = v; } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve };
}
describe('remote read protocol boundary (no live auth or encryption)', () => {
  it('defaults to fail-closed before any snapshot read', async () => {
    const s = setup();
    for (const router of [new RemoteSnapshotRouter(), new RemoteSnapshotRouter({ ...s.options, enabled: false }),
      new RemoteSnapshotRouter({ ...s.options, security: undefined! })]) {
      expect(router.state).toBe('unconfigured');
      await expect(router.handle(s.frame)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    }
    expect(s.read).not.toHaveBeenCalled();
  });
  it('routes only a read of detached, redacted latest data and binds its SHA256 revision', async () => {
    const s = setup(), raw = snapshot();
    Object.assign(raw, { internalSourcePath: 'private-test-path', rawSave: 'test-only-never-send' });
    s.read.mockResolvedValue({ snapshot: raw, publicationVersion: 1 });
    const sealed = await s.router.handle(s.frame), result = s.getResult();
    expect(sealed.ciphertext).toEqual(new Uint8Array([2]));
    expect(sealed).not.toHaveProperty('snapshot');
    expect(result.snapshot?.safety.originalMainSaveSha256).toBe('已隐藏');
    expect(result.snapshot).not.toHaveProperty('rawSave');
    expect(result.snapshot).not.toHaveProperty('internalSourcePath');
    expect(raw.safety.originalMainSaveSha256).toBe('never-export-this-hash');
    expect(await verifyRemoteSnapshotResult(result, s.req, () => now, digest)).toEqual(result);
    expect(s.router.requestState('app-1', 'request-1')).toBe('completed');
  });
  it.each(['issuer', 'subject'] as const)('rejects another account %s before reading data', async key => {
    const s = setup(); s.sender.account[key] = key === 'issuer' ? 'https://other.example' : 'different-subject';
    await expect(s.router.handle(s.frame)).rejects.toMatchObject({ code: 'UNAUTHORIZED' }); expect(s.read).not.toHaveBeenCalled();
  });
  it.each(['fromDeviceId', 'toDeviceId', 'requestId'] as const)('rejects mismatched ciphertext routing %s', async key => {
    const s = setup(); s.frame[key] = 'mismatched';
    await expect(s.router.handle(s.frame)).rejects.toMatchObject({ code: 'UNAUTHORIZED' }); expect(s.read).not.toHaveBeenCalled();
  });
  it('rejects stale/overlong requests, unknown actions and email identity substitutions', () => {
    const r = request();
    for (const invalid of [{ ...r, expiresAt: now }, { ...r, issuedAt: now + 5001 },
      { ...r, expiresAt: now + 60_001 }, { ...r, type: 'snapshot.refresh' }, { ...r, protocol: 'nioh-relay/2' },
      { ...r, account: { ...account, email: 'test@example.invalid' } }, { ...r, knownRevision: 'a'.repeat(64) }]) {
      expect(() => parseRemoteSnapshotRequest(invalid, now)).toThrow();
    }
  });
  it('rejects revoked or rotated devices before reading data', async () => {
    for (const change of ['revoked', 'version', 'key'] as const) {
      const s = setup(), d = s.devices.get('app-1')!;
      if (change === 'revoked') d.state = 'revoked'; else if (change === 'version') d.version++; else d.keyId = 'another-key-reference';
      await expect(s.router.handle(s.frame)).rejects.toThrow(); expect(s.read).not.toHaveBeenCalled();
    }
  });
  it('reserves concurrent request IDs and does not damage the first request on replay', async () => {
    const s = setup(), pending = deferred<RemotePublication>(); s.read.mockImplementation(() => pending.promise);
    const first = s.router.handle(s.frame); await vi.waitFor(() => expect(s.read).toHaveBeenCalledOnce());
    await expect(s.router.handle(s.frame)).rejects.toMatchObject({ code: 'REPLAY' });
    expect(s.router.requestState('app-1', 'request-1')).toBe('reading');
    pending.resolve({ snapshot: snapshot(), publicationVersion: 1 }); await first;
    await expect(s.router.handle(s.frame)).rejects.toMatchObject({ code: 'REPLAY' }); expect(s.read).toHaveBeenCalledOnce();
  });
  it.each(['device', 'pc-key', 'disconnect', 'router', 'expiry', 'auth-expiry'] as const)('blocks in-flight export after %s changes', async change => {
    const s = setup(), pending = deferred<RemotePublication>(); s.read.mockImplementation(() => pending.promise);
    const result = s.router.handle(s.frame); const failure = expect(result).rejects.toThrow();
    await vi.waitFor(() => expect(s.read).toHaveBeenCalledOnce());
    if (change === 'device') s.devices.get('app-1')!.state = 'revoked';
    if (change === 'pc-key') s.devices.get('pc-1')!.keyId = 'rotated-key-reference';
    if (change === 'disconnect') { s.router.disconnected(); s.router.beginConnect(); s.router.connected(); }
    if (change === 'router') s.router.revoke();
    if (change === 'expiry') s.setTime(s.req.expiresAt);
    if (change === 'auth-expiry') s.setTime(s.sender.authorizationExpiresAt);
    pending.resolve({ snapshot: snapshot(), publicationVersion: 1 }); await failure; expect(s.seal).not.toHaveBeenCalled();
  });
  it('rechecks revocation after sealing and never releases the sealed reply', async () => {
    const s = setup(), pending = deferred<RelayCiphertext>(); s.seal.mockImplementation(() => pending.promise);
    const result = s.router.handle(s.frame); const failure = expect(result).rejects.toMatchObject({ code: 'REVOKED' });
    await vi.waitFor(() => expect(s.seal).toHaveBeenCalledOnce()); s.devices.get('app-1')!.state = 'revoked';
    pending.resolve({ ...s.frame, fromDeviceId: 'pc-1', toDeviceId: 'app-1' }); await failure;
  });
  it('returns not-modified only for the same snapshot ID and revision', async () => {
    const s = setup(); await s.router.handle(s.frame); const previous = s.getResult();
    s.req.requestId = s.frame.requestId = 'request-2'; s.req.knownSnapshotId = previous.snapshotId; s.req.knownRevision = previous.revision;
    await s.router.handle(s.frame); expect(s.getResult().snapshot).toBeNull(); expect(s.getResult().outcome).toBe('not-modified');
    expect(parseRemoteSnapshotResult(s.getResult(), s.req, now).revision).toBe(previous.revision);
  });
  it('rejects swapped responses and changed payload content before a future cache commit', async () => {
    const s = setup(); await s.router.handle(s.frame); const result = s.getResult();
    expect(() => parseRemoteSnapshotResult({ ...result, requestId: 'another-request' }, s.req, now)).toThrow();
    expect(() => parseRemoteSnapshotResult({ ...result, account: { ...account, subject: 'another-user' } }, s.req, now)).toThrow();
    const changed = structuredClone(result); changed.snapshot!.character.level++;
    await expect(verifyRemoteSnapshotResult(changed, s.req, () => now, digest)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    await expect(verifyRemoteSnapshotResult(result, s.req, () => now)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
  it('sanitizes provider errors and rejects empty encryption output', async () => {
    const s = setup(); s.read.mockRejectedValue(new Error('private-path/credential'));
    await expect(s.router.handle(s.frame)).rejects.toMatchObject({ message: 'UNAVAILABLE' });
    const t = setup(); t.seal.mockImplementation(async message => ({ ...t.frame, fromDeviceId: message.fromDeviceId,
      toDeviceId: message.toDeviceId, ciphertext: new Uint8Array() }));
    await expect(t.router.handle(t.frame)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('accepts native object key reordering but rejects expiry during checksum verification', async () => {
    const s = setup(); await s.router.handle(s.frame);
    const result = structuredClone(s.getResult());
    result.snapshot = Object.fromEntries(Object.entries(result.snapshot!).reverse()) as unknown as SaveSnapshot;
    expect(await verifyRemoteSnapshotResult(result, s.req, () => now, digest)).toEqual(result);
    let time = now;
    const delayedDigest = async (bytes: Uint8Array) => { time = result.expiresAt; return digest(bytes); };
    await expect(verifyRemoteSnapshotResult(result, s.req, () => time, delayedDigest)).rejects.toMatchObject({ code: 'STALE' });
  });
});
