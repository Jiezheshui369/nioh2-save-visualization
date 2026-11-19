/** DO storage adapter: crypto executes OUTSIDE actual storage transactions.
 * Short snapshot and CAS transactions persist only enrollment metadata. A
 * competing committed revision retries the whole pure operation, at most 4x.
 * This adapter requires exclusive ownership of its account/device/request keys.
 */
import { EnrollmentError } from './enrollment.js';
const prefixes=['device:','join:','revoke:','connect:'];
const singles=['account','bootstrap','enrollment:rate'];
const revisionKey='enrollment:storage-revision';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
class BufferedStore {
  constructor(values){this.values=structuredClone(values);}
  async get(key){return structuredClone(this.values.get(key));}
  async put(key,value){this.values.set(key,structuredClone(value));}
  async delete(key){this.values.delete(key);}
  async list({prefix}){return new Map([...this.values].filter(([key])=>key.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
}
export class EnrollmentStorage {
  constructor(storage,{now=Date.now,invalidate=()=>{}}={}){this.storage=storage;this.now=now;this.invalidate=invalidate;}
  async transaction(callback,{validate=()=>{}}={}){
    for(let attempt=0;attempt<4;attempt++){
      const snapshot=await this.storage.transaction(async tx=>{
        const revision=(await tx.get(revisionKey))??0;
        if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw new EnrollmentError('CAPACITY');
        const values=new Map();
        for(const key of singles){const v=await tx.get(key);if(v!==undefined)values.set(key,v);}
        for(const prefix of prefixes)for(const [k,v] of await tx.list({prefix,limit:257}))values.set(k,v);
        if(values.size>256)throw new EnrollmentError('CAPACITY');
        return {revision,values};
      });
      const buffer=new BufferedStore(snapshot.values);
      for(const [k,v] of buffer.values)if((k.startsWith('join:')||k.startsWith('revoke:')||k.startsWith('connect:'))&&v.expiresAt<=this.now())buffer.values.delete(k);
      const result=await callback(buffer); // WebCrypto awaits are never in a DO transaction.
      const keys=new Set([...snapshot.values.keys(),...buffer.values.keys()]);
      const changed=[...keys].filter(k=>!equal(snapshot.values.get(k),buffer.values.get(k)));
      // Never allow callbacks to write arbitrary session, payload or revision keys.
      if(changed.some(k=>!singles.includes(k)&&!prefixes.some(prefix=>k.startsWith(prefix))))throw new EnrollmentError('INVALID_STORAGE_KEY');
      if(buffer.values.size>256)throw new EnrollmentError('CAPACITY');
      const committed=await this.storage.transaction(async tx=>{
        if(((await tx.get(revisionKey))??0)!==snapshot.revision)return false;
        validate();
        for(const key of changed){
          const value=buffer.values.get(key),expires=value?.expiresAt??
            (key.startsWith('device:')&&value?.state==='active'&&snapshot.values.get(key)?.state!=='active'?value?.registration?.transcript?.expiresAt:undefined);
          if(expires!==undefined&&expires<=this.now())throw new EnrollmentError('EXPIRED');
        }
        for(const key of changed){if(buffer.values.has(key))await tx.put(key,buffer.values.get(key));else await tx.delete(key);}
        if(changed.length)await tx.put(revisionKey,snapshot.revision+1);
        // Conservative fail-closed invalidation before returning to any awaiting
        // message handler. A platform transaction retry may close early; never send
        // from a stale attachment while a revocation commit is finishing.
        const devices=changed.filter(k=>k.startsWith('device:')).map(k=>k.slice(7));
        for(const key of changed){const value=buffer.values.get(key);if(key.startsWith('join:')&&['rejected','cancelled'].includes(value?.state))devices.push(value.candidate.id);}
        if(devices.length)this.invalidate(devices);
        return true;
      });
      if(committed)return result;
    }
    throw new EnrollmentError('CONFLICT');
  }
}
