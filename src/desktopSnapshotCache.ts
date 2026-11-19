import type { DeviceArchiveInfo, SaveSnapshot, SnapshotSummary } from './types';
import { isSupportedSnapshot } from './snapshotValidation';
import { readableSnapshotIndex } from './snapshotSummary';
import { mergeCachedSnapshotIndex } from './snapshotCache';
import { validDesktopContext } from './desktopDataContext';
import type { DesktopDataContext } from './desktopDataContext';
const STORE = 'snapshots';
export const desktopSessionSnapshotKey = (context: DesktopDataContext) => 'session:' + context.sessionId + ':latest';
export function desktopDatabaseName(context: DesktopDataContext): string {
  if (!validDesktopContext(context)) throw new Error('LOCAL_DATA_CONTEXT_INVALID');
  return 'saveasset-desktop-account-' + context.accountScope;
}
function open(context: DesktopDataContext): Promise<IDBDatabase> {
  const name=desktopDatabaseName(context);
  if (!window.indexedDB) return Promise.reject(new Error('本地存储不可用，当前档案未替换。'));
  return new Promise((resolve,reject) => {
    const request=indexedDB.open(name,1);let blocked=false;
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
    request.onsuccess=()=>{if(blocked){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>{blocked=true;reject(new Error('本地档案库被占用，请关闭旧窗口后重试。'));};
  });
}
/** Account databases and session keys never read, adopt or delete the old unscoped mobile cache. */
export async function saveDesktopSnapshot(context:DesktopDataContext,input:SaveSnapshot,info?:DeviceArchiveInfo,isCurrent=()=>true):Promise<void> {
  if(!isSupportedSnapshot(input))throw new Error('角色档案不完整，当前档案未替换。');
  if(info && (info.sourceSnapshotId!==input.snapshotId || !Number.isFinite(Date.parse(info.importedAt))))throw new Error('档案来源记录与角色不一致。');
  const snapshot=structuredClone(input), metadata=info===undefined?undefined:structuredClone(info), captured={...context};
  if(!isCurrent())throw new Error('LOCAL_DATA_CONTEXT_CHANGED');
  const db=await open(captured);
  try {
    if(!isCurrent())throw new Error('LOCAL_DATA_CONTEXT_CHANGED');
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('本地保存未完成，当前档案未替换。'));
      try {
        const store=tx.objectStore(STORE);store.put(snapshot,desktopSessionSnapshotKey(captured));store.put(snapshot,'snapshot:'+snapshot.snapshotId);
        if(metadata)store.put(metadata,'session:'+captured.sessionId+':archive-info');
        const request=store.get('index');
        request.onsuccess=()=>{try{if(!isCurrent())throw new Error('LOCAL_DATA_CONTEXT_CHANGED');store.put(mergeCachedSnapshotIndex(readableSnapshotIndex(request.result),snapshot),'index');}catch(error){tx.abort();reject(error);}};
      } catch(error){tx.abort();reject(error);}
    });
  } finally { db.close(); }
}
async function read(context:DesktopDataContext,key:string):Promise<unknown> {
  const db=await open(context);
  try {return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const request=tx.objectStore(STORE).get(key);let value:unknown;request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
  finally {db.close();}
}
/** Explicit inspection/recovery only. Desktop startup never auto-selects this record. */
export async function loadDesktopCachedSnapshot(context:DesktopDataContext):Promise<SaveSnapshot|null> {
  const value=await read(context,desktopSessionSnapshotKey(context));return isSupportedSnapshot(value)?value:null;
}
export async function loadDesktopSnapshotIndex(context:DesktopDataContext):Promise<SnapshotSummary[]> {
  return readableSnapshotIndex(await read(context,'index'));
}
