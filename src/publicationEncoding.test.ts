import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import vectors from '../contracts/publication-v1-vectors.json';
import { publicationBytes } from './publicationEncoding';
import { validateLocalPublication } from './localPublication';
import { createShareSnapshot } from './privacy';
import { remoteSnapshotBytes } from './remoteSyncProtocol';

const digest = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
describe('fixed cross-language publication contract', () => {
  it.each(vectors)('matches fixed bytes and SHA256: $name', async vector => {
    const bytes = publicationBytes(vector.value);
    expect(Buffer.from(bytes).toString('hex')).toBe(vector.bytesHex);
    expect(await digest(bytes)).toBe(vector.sha256);
  });
  it('rejects lossy or unsupported data; normalizes negative zero and object order', () => {
    for (const value of [NaN,Infinity,-Infinity,9007199254740992,'\ud800',{'\udfff':1},[undefined],BigInt(1)]) {
      expect(() => publicationBytes(value)).toThrow();
    }
    expect(publicationBytes({z:-0,a:1})).toEqual(publicationBytes({a:1,z:0}));
    expect(publicationBytes({a:undefined})).toEqual(publicationBytes({}));
    expect(() => publicationBytes(Array(1))).toThrow();
  });
  it('actual Python parser -> SQLite -> readonly API projection -> TypeScript -> router hash', async () => {
    const payload = JSON.parse(execFileSync(process.env.PUBLICATION_TEST_PYTHON ?? 'python',
      ['-B','-m','agent.tools.synthetic_publication_contract'], { cwd: process.cwd(), encoding:'utf8',
        maxBuffer: 4*1024*1024, env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'} }));
    expect(payload.synthetic).toBe(true); expect(payload.databaseUnchanged).toBe(true);
    const projected = JSON.parse(JSON.stringify(createShareSnapshot(payload.raw)));
    expect(payload.publication.snapshot).toEqual(projected);
    expect(await digest(remoteSnapshotBytes(projected))).toBe(payload.publication.revision);
    expect(await validateLocalPublication(payload.publication,digest)).toEqual({snapshot:projected,publicationVersion:1});
    expect(projected).not.toHaveProperty('internalPath');
    expect(projected.scrolls[0]).not.toHaveProperty('equipIndex');
    expect(projected.character.attributes).not.toHaveProperty('privateDiagnostic');
    await expect(validateLocalPublication({...payload.publication,revision:'0'.repeat(64)},digest)).rejects.toThrow();
    await expect(validateLocalPublication({...payload.publication,revisionContract:'legacy-python-json/0'},digest)).rejects.toThrow();
    const delayed = vi.fn(async () => {
      payload.publication.snapshot.character.level = 999;
      return digest(remoteSnapshotBytes(projected));
    });
    expect((await validateLocalPublication(payload.publication,delayed)).snapshot.character.level).toBe(projected.character.level);
  });
});
