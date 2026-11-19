/** Offline enrollment core. NOT imported by Worker, no routes or key generation.
 * Injected verifier must validate OIDC access/reauthentication evidence. Objects
 * returned by clients are never accepted as authenticated principals.
 */
import { accountKey, deviceId } from './auth.js';
const encoder = new TextEncoder();
const clone = value => structuredClone(value);
const TTL = 120_000, MAX_DEVICES = 16, MAX_PENDING = 8;
const principals = new WeakMap();
export class EnrollmentError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new EnrollmentError(code); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join();
const keyBytes = k => [k.kty, k.crv, k.x, k.y];
const deviceBytes = d => [d.id, d.role, d.version, d.keyId, keyBytes(d.agreementKey), keyBytes(d.signingKey)];
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
const sameAccount = (a,b) => a.issuer === b.issuer && a.subject === b.subject;
const account = p => ({ issuer:p.issuer, subject:p.subject });
const signatureBytes = value => { if(!(value instanceof Uint8Array)||value.length!==64)fail('INVALID_PROOF');return value.slice(); };

export class EnrollmentAuthority {
  constructor({ verify, clients, now = Date.now } = {}) { this.verify = verify; this.clients = clients; this.now = now; }
  async authenticate(token) {
    if (typeof this.verify !== 'function' || !this.clients) fail('NOT_CONFIGURED');
    const value = await this.verify(token); // Trusted dependency; never a decoded/unverified JWT.
    if (!value || typeof value.issuer !== 'string' || typeof value.subject !== 'string' || !value.subject.trim() || value.subject.length > 255
      || !['pc','app'].includes(this.clients[value.clientId]) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= this.now()) fail('UNAUTHORIZED');
    const url = new URL(value.issuer);
    if (url.protocol !== 'https:' || url.href !== value.issuer || url.pathname !== '/' || url.username || url.password || url.search || url.hash) fail('UNAUTHORIZED');
    const capability = Object.freeze({});
    principals.set(capability, { authority:this, principal:{ issuer:value.issuer, subject:value.subject, clientId:value.clientId,
      expiresAt:value.expiresAt, authenticatedAt:Number.isSafeInteger(value.authenticatedAt)&&value.authenticatedAt>=0&&value.authenticatedAt<=this.now()?value.authenticatedAt:null, role:this.clients[value.clientId] } });
    return capability;
  }
  resolve(capability, role, fresh = true) {
    const stored = principals.get(capability), p = stored?.principal;
    if (stored?.authority !== this || !p || p.expiresAt <= this.now() || role && p.role !== role
      || fresh && (!Number.isSafeInteger(p.authenticatedAt)||p.authenticatedAt<0||p.authenticatedAt>this.now()||this.now() - p.authenticatedAt > 300_000)) fail('UNAUTHORIZED');
    return clone(p);
  }
}

async function publicKey(value, algorithm) {
  if (!exact(value,['kty','crv','x','y']) || value.kty !== 'EC' || value.crv !== 'P-256'
    || ![value.x,value.y].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v))) fail('INVALID_PUBLIC_KEY');
  try { await crypto.subtle.importKey('jwk', value, { name:algorithm,namedCurve:'P-256' }, false, algorithm === 'ECDSA' ? ['verify'] : []); }
  catch { fail('INVALID_PUBLIC_KEY'); }
  return clone(value);
}
async function candidate(value, role) {
  const d = clone(value);
  if (!exact(d,['id','keyId','agreementKey','signingKey']) || !deviceId(d.id) || !deviceId(d.keyId)) fail('INVALID_DEVICE');
  d.agreementKey = await publicKey(d.agreementKey,'ECDH'); d.signingKey = await publicKey(d.signingKey,'ECDSA');
  return { ...d,role,version:1 };
}
export function enrollmentBytes(record, purpose) {
  if (!['first-pc','phone-proof','phone-approve','phone-reject','phone-withdraw','device-revoke'].includes(purpose)) fail('INVALID_PURPOSE');
  return encoder.encode(JSON.stringify(['save-asset-enrollment/1',purpose,record.account.issuer,record.account.subject,record.accountEpoch,
    record.id,record.nonce,record.issuedAt,record.expiresAt,record.root ? deviceBytes(record.root) : null,deviceBytes(record.candidate)]));
}
export async function verificationPhrase(record) {
  // 96-bit transcript fingerprint: comparison only, never a password or proof.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',enrollmentBytes(record,'phone-proof')));
  return Array.from(digest.slice(0,12),x=>x.toString(16).padStart(2,'0')).join('').toUpperCase().match(/.{4}/g).join(' ');
}
async function validSignature(record,purpose,key,signature) {
  if (!(signature instanceof Uint8Array) || signature.length !== 64) return false;
  try {
    const publicKey = await crypto.subtle.importKey('jwk',key,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,signature,enrollmentBytes(record,purpose));
  } catch { return false; }
}

export class EnrollmentService {
  constructor({ enabled = false, authority, store, now = Date.now } = {}) { this.enabled=enabled;this.authority=authority;this.store=store;this.now=now; }
  principal(capability,role,fresh=true) { if(!this.enabled || !this.authority || !this.store) fail('NOT_CONFIGURED');return this.authority.resolve(capability,role,fresh); }
  async transaction(capability,role,callback,{fresh=true}={}) {
    const result = await this.store.transaction(async tx => callback(tx,this.principal(capability,role,fresh)),
      {validate:()=>this.principal(capability,role,fresh)});
    if(result?.error) fail(result.error);
    return result;
  }
  fresh(record) { if(!record || record.expiresAt <= this.now()) fail('EXPIRED'); }
  async meta(tx,p) {
    const m=await tx.get('account');
    if(m && (m.accountKey !== await accountKey(p) || !sameAccount(m.account,p))) fail('UNAUTHORIZED');
    return m;
  }
  async root(tx,p,m) {
    const root=m && await tx.get('device:'+m.rootId);
    if(!root || root.state!=='active' || root.role!=='pc' || !sameAccount(root.account,p)) fail('PC_NOT_AUTHORIZED');
    return root;
  }
  async bound(tx,p,record) {
    if(!sameAccount(record.account,p)) fail('UNAUTHORIZED');
    const m=await this.meta(tx,p);
    if(!m || m.accountEpoch!==record.accountEpoch) fail('STALE');
    if(record.root) {
      const current=await this.root(tx,p,m);
      if(JSON.stringify(deviceBytes(current))!==JSON.stringify(deviceBytes(record.root))) fail('STALE');
    }
    return m;
  }
  view(record) { return clone(record); }
  async state(capability) {
    this.principal(capability,null,false);
    return this.transaction(capability,null,async(tx,p)=>{
      const m=await this.meta(tx,p);if(!m)return {state:'no-pc'};
      if(m.rootId) {const root=await tx.get('device:'+m.rootId);return {state:root?.state==='active'?'pc-ready':'pc-revoked',revision:m.revision};}
      const pending=await tx.get('bootstrap');return {state:pending?.expiresAt>this.now()?'pc-awaiting-proof':'pc-enrollment-expired'};
    },{fresh:false});
  }
  async beginFirstPc(capability,value) {
    this.principal(capability,'pc');const d=await candidate(value,'pc');
    return this.transaction(capability,'pc',async(tx,p)=>{
      let m=await this.meta(tx,p);if(m?.rootId)fail('ALREADY_ENROLLED');
      if(!m&&(await tx.list({prefix:'device:'})).size)fail('MIGRATION_REQUIRED');
      const old=await tx.get('bootstrap');if(old?.expiresAt>this.now()&&old.state==='awaiting-proof')fail('BUSY');
      m ??= {schemaVersion:1,account:account(p),accountKey:await accountKey(p),accountEpoch:1,rootId:null,revision:0};
      const record={id:random(),nonce:random(),account:account(p),accountEpoch:m.accountEpoch,issuedAt:this.now(),expiresAt:this.now()+TTL,
        root:null,candidate:d,state:'awaiting-proof',attempts:0};
      await tx.put('account',m);await tx.put('bootstrap',record);return this.view(record);
    });
  }
  async finishFirstPc(capability,id,signature) {
    this.principal(capability,'pc');const proof=signatureBytes(signature);
    return this.transaction(capability,'pc',async(tx,p)=>{
      const r=await tx.get('bootstrap');this.fresh(r);if(r.id!==id||r.state!=='awaiting-proof')fail('REPLAY');
      const m=await this.bound(tx,p,r);if(m.rootId)fail('ALREADY_ENROLLED');
      if(!await validSignature(r,'first-pc',r.candidate.signingKey,proof))return this.bad(tx,'bootstrap',r,'INVALID_PROOF');
      this.authority.resolve(capability,'pc');this.fresh(r);
      await tx.put('device:'+r.candidate.id,{...r.candidate,account:r.account,state:'active',approvedBy:r.candidate.id,approvedAt:this.now(),
        registration:{purpose:'first-pc',transcript:clone(r),signature:Array.from(proof)}});
      await tx.put('account',{...m,rootId:r.candidate.id,revision:m.revision+1});
      await tx.put('bootstrap',{...r,state:'completed'});return {state:'pc-ready',deviceId:r.candidate.id};
    });
  }
  async beginPhoneJoin(capability,value) {
    this.principal(capability,'app');const d=await candidate(value,'app');
    return this.transaction(capability,'app',async(tx,p)=>{
      const m=await this.meta(tx,p),root=await this.root(tx,p,m);
      if(await tx.get('device:'+d.id))fail('DEVICE_ID_USED');
      const devices=await tx.list({prefix:'device:'});if(devices.size>=MAX_DEVICES)fail('CAPACITY');
      const pending=await tx.list({prefix:'join:'});const active=[...pending.values()].filter(v=>v.expiresAt>this.now()&&['awaiting-proof','pending-approval'].includes(v.state));
      if(active.length>=MAX_PENDING)fail('CAPACITY');if(active.some(v=>v.candidate.id===d.id))fail('BUSY');
      const r={id:random(),nonce:random(),account:account(p),accountEpoch:m.accountEpoch,issuedAt:this.now(),expiresAt:this.now()+TTL,
        root:{id:root.id,role:root.role,version:root.version,keyId:root.keyId,agreementKey:root.agreementKey,signingKey:root.signingKey},candidate:d,state:'awaiting-proof',attempts:0};
      await tx.put('join:'+r.id,r);return this.view(r);
    });
  }
  async bad(tx,key,r,error) {
    const attempts=r.attempts+1;await tx.put(key,{...r,attempts,state:attempts>=3?'rejected':r.state});return {error};
  }
  async provePhoneJoin(capability,id,signature) {
    this.principal(capability,'app');const proof=signatureBytes(signature);
    return this.transaction(capability,'app',async(tx,p)=>{
      const r=await tx.get('join:'+id);this.fresh(r);if(r.state!=='awaiting-proof')fail('REPLAY');await this.bound(tx,p,r);
      if(!await validSignature(r,'phone-proof',r.candidate.signingKey,proof))return this.bad(tx,'join:'+id,r,'INVALID_PROOF');
      this.authority.resolve(capability,'app');this.fresh(r);await tx.put('join:'+id,{...r,state:'pending-approval'});
      return {state:'pending-approval',phrase:await verificationPhrase(r)};
    });
  }
  async decidePhone(capability,id,decision,phrase,signature) {
    this.principal(capability,'pc');if(!['approve','reject'].includes(decision))fail('INVALID_DECISION');const proof=signatureBytes(signature);
    return this.transaction(capability,'pc',async(tx,p)=>{
      const r=await tx.get('join:'+id);this.fresh(r);if(r.state!=='pending-approval')fail('REPLAY');const m=await this.bound(tx,p,r);
      if(phrase!==await verificationPhrase(r))return this.bad(tx,'join:'+id,r,'PHRASE_MISMATCH');
      if(!await validSignature(r,'phone-'+decision,r.root.signingKey,proof))return this.bad(tx,'join:'+id,r,'INVALID_PROOF');
      this.authority.resolve(capability,'pc');this.fresh(r);
      if(decision==='reject'){await tx.put('join:'+id,{...r,state:'rejected'});return {state:'rejected'};}
      if(await tx.get('device:'+r.candidate.id))fail('DEVICE_ID_USED');
      if((await tx.list({prefix:'device:'})).size>=MAX_DEVICES)fail('CAPACITY');
      await tx.put('device:'+r.candidate.id,{...r.candidate,account:r.account,state:'active',approvedBy:r.root.id,approvedAt:this.now(),
        registration:{purpose:'phone-approve',transcript:clone(r),signature:Array.from(proof)}});
      await tx.put('account',{...m,revision:m.revision+1});await tx.put('join:'+id,{...r,state:'approved',approvalSignature:Array.from(proof)});
      return {state:'approved',deviceId:r.candidate.id};
    });
  }
  async withdrawPhone(capability,id,signature) {
    this.principal(capability,'app');const proof=signatureBytes(signature);
    return this.transaction(capability,'app',async(tx,p)=>{
      const r=await tx.get('join:'+id);this.fresh(r);if(!['awaiting-proof','pending-approval'].includes(r.state))fail('REPLAY');await this.bound(tx,p,r);
      if(!await validSignature(r,'phone-withdraw',r.candidate.signingKey,proof))fail('INVALID_PROOF');
      this.authority.resolve(capability,'app');this.fresh(r);await tx.put('join:'+id,{...r,state:'cancelled'});return {state:'cancelled'};
    });
  }
  async beginDeviceRevoke(capability,deviceId) {
    this.principal(capability,'pc');
    return this.transaction(capability,'pc',async(tx,p)=>{
      const m=await this.meta(tx,p),root=await this.root(tx,p,m),d=await tx.get('device:'+deviceId);
      if(!d||!['pc','app'].includes(d.role)||d.state!=='active'||!sameAccount(d.account,p))fail('DEVICE_NOT_ACTIVE');
      const r={id:random(),nonce:random(),account:account(p),accountEpoch:m.accountEpoch,issuedAt:this.now(),expiresAt:this.now()+TTL,
        root:{id:root.id,role:root.role,version:root.version,keyId:root.keyId,agreementKey:root.agreementKey,signingKey:root.signingKey},
        candidate:{id:d.id,role:d.role,version:d.version,keyId:d.keyId,agreementKey:d.agreementKey,signingKey:d.signingKey},state:'pending',attempts:0};
      await tx.put('revoke:'+r.id,r);return this.view(r);
    });
  }
  async revokeDevice(capability,id,signature) {
    this.principal(capability,'pc');const proof=signatureBytes(signature);
    return this.transaction(capability,'pc',async(tx,p)=>{
      const r=await tx.get('revoke:'+id);this.fresh(r);if(r.state!=='pending')fail('REPLAY');const m=await this.bound(tx,p,r);
      const d=await tx.get('device:'+r.candidate.id);if(!d||d.state!=='active'||d.version!==r.candidate.version||d.keyId!==r.candidate.keyId)fail('STALE');
      if(!await validSignature(r,'device-revoke',r.root.signingKey,proof))fail('INVALID_PROOF');
      this.authority.resolve(capability,'pc');this.fresh(r);
      await tx.put('device:'+d.id,{...d,state:'revoked',version:d.version+1,revokedAt:this.now()});
      if(d.id===m.rootId)for(const [key,device] of await tx.list({prefix:'device:'})){
        if(device.id!==d.id&&device.state==='active')await tx.put(key,{...device,state:'revoked',version:device.version+1,revokedAt:this.now()});
      }
      await tx.put('account',{...m,revision:m.revision+1,accountEpoch:m.accountEpoch+(d.id===m.rootId?1:0)});
      await tx.put('revoke:'+id,{...r,state:'completed'});return {state:'revoked',deviceId:d.id};
    });
  }
}
