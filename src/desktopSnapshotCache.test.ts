import { beforeEach,describe,it,expect,vi } from 'vitest';
import { IDBFactory,IDBObjectStore } from 'fake-indexeddb';
import fixture from '../public/data/demo-snapshot.json';
import type { SaveSnapshot } from './types';
import { titleFixture } from './test/titleFixture';
import { saveCachedSnapshot,loadCachedSnapshot } from './snapshotCache';
import { saveDesktopSnapshot,loadDesktopCachedSnapshot,loadDesktopSnapshotIndex,desktopDatabaseName } from './desktopSnapshotCache';
import { accountStatus } from './nativeAccount';
import { desktopContextFromStatus,desktopContextHeaders } from './desktopDataContext';
const A={accountScope:'a'.repeat(64),sessionId:'1'.repeat(64)},B={accountScope:'b'.repeat(64),sessionId:'2'.repeat(64)};
const snapshot=(id:string,level:number)=>({...structuredClone(fixture),snapshotId:id,character:{...fixture.character,level}} as SaveSnapshot);
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());});
describe('desktop scoped archive storage',()=>{
 it('separates accounts and never adopts or deletes unscoped legacy/mobile data',async()=>{
  await saveCachedSnapshot(snapshot('legacy',111));await saveDesktopSnapshot(A,snapshot('same-id',222));await saveDesktopSnapshot(B,snapshot('same-id',333));
  expect((await loadDesktopCachedSnapshot(A))?.character.level).toBe(222);
  expect((await loadDesktopCachedSnapshot(B))?.character.level).toBe(333);
  expect((await loadCachedSnapshot())?.character.level).toBe(111);
  expect(desktopDatabaseName(A)).not.toBe(desktopDatabaseName(B));
 });
 it('keeps a fresh session unselected while preserving its account history',async()=>{
  await saveDesktopSnapshot(A,snapshot('previous',222));
  const fresh={...A,sessionId:'3'.repeat(64)};
  expect(await loadDesktopCachedSnapshot(fresh)).toBeNull();
  expect((await loadDesktopSnapshotIndex(fresh))[0].snapshotId).toBe('previous');
  expect((await loadDesktopCachedSnapshot(A))?.snapshotId).toBe('previous');
 });
 it('rejects a revoked async write and preserves previously committed identity',async()=>{
  await saveDesktopSnapshot(A,snapshot('old',111));
  let current=true;const pending=saveDesktopSnapshot(A,snapshot('late',222),undefined,()=>current);current=false;
  await expect(pending).rejects.toThrow('LOCAL_DATA_CONTEXT_CHANGED');
  expect((await loadDesktopCachedSnapshot(A))?.snapshotId).toBe('old');
  expect(await loadDesktopCachedSnapshot(B)).toBeNull();
 });
 it('does not report a failed transaction as a successful replacement',async()=>{
  await saveDesktopSnapshot(A,snapshot('old',111));
  const put=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
  await expect(saveDesktopSnapshot(A,snapshot('new',222))).rejects.toThrow();put.mockRestore();
  expect((await loadDesktopCachedSnapshot(A))?.snapshotId).toBe('old');
 });
 it('captures independent context and snapshot copies before asynchronous opening',async()=>{
  const context={...A},record=snapshot('captured',222);
  const pending=saveDesktopSnapshot(context,record);context.accountScope=B.accountScope;record.character.level=999;
  await pending;expect((await loadDesktopCachedSnapshot(A))?.character.level).toBe(222);expect(await loadDesktopCachedSnapshot(B)).toBeNull();
 });
 it('persists an independent title snapshot and restores it offline', async()=>{
  const record={...snapshot('titles',222),titles:titleFixture([4707])} as SaveSnapshot;
  await saveDesktopSnapshot(A,record);
  record.titles!.entries[0].savedAwarded=false;
  const restored=await loadDesktopCachedSnapshot(A);
  expect(restored?.titles?.entries.find(e=>e.titleId===4707)?.savedAwarded).toBe(true);
  expect(restored?.titles?.summary.awarded).toBe(1);
 });
 it('fails closed for missing or malformed scope instead of using a shared database',async()=>{
  expect(()=>desktopDatabaseName({...A,accountScope:'../escape'})).toThrow('LOCAL_DATA_CONTEXT_INVALID');
  expect(()=>desktopContextHeaders({...A,sessionId:'old'})).toThrow();
  expect(desktopContextFromStatus({state:'signed-in'})).toBeNull();
  expect(desktopContextFromStatus({state:'signed-out',localDataScope:A.accountScope,localDataSessionId:A.sessionId})).toBeNull();
  expect(desktopContextFromStatus(accountStatus({state:'signed-in',localDataScope:A.accountScope,localDataSessionId:A.sessionId,id_token:'secret',sub:'private'}))).toEqual(A);
  expect(accountStatus({state:'signed-out',localDataScope:A.accountScope,localDataSessionId:A.sessionId})).not.toHaveProperty('localDataScope');
 });
});
