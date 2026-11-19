import {clientRole} from './client-roles.js';
export {clientRole} from './client-roles.js';
/** Native WebSocket admission: account JWT plus one-use registered-key proof. */
import {accountKey,deviceId,decodeBase64Url,fail} from './auth.js';
const bytes=new TextEncoder(),random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const publicDevice=d=>({id:d.id,role:d.role,version:d.version,keyId:d.keyId,signingKey:d.signingKey,agreementKey:d.agreementKey});
async function digest(token){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
export function connectionBytes(r){return bytes.encode(JSON.stringify(['save-asset-connect/1','GET','/v1/connect',r.account.issuer,r.account.subject,r.accountEpoch,
  r.id,r.nonce,r.issuedAt,r.expiresAt,r.clientId,r.tokenDigest,r.device.id,r.device.role,r.device.version,r.device.keyId,
  [r.device.signingKey.kty,r.device.signingKey.crv,r.device.signingKey.x,r.device.signingKey.y],
  [r.device.agreementKey.kty,r.device.agreementKey.crv,r.device.agreementKey.x,r.device.agreementKey.y]]));}
async function current(tx,identity,id,env){
  const m=await tx.get('account'),d=await tx.get('device:'+id);
  if(!m||m.accountKey!==await accountKey(identity)||m.account?.issuer!==identity.issuer||m.account?.subject!==identity.subject
    ||!m.rootId||!d||d.state!=='active'||d.id!==id||d.account?.issuer!==identity.issuer||d.account?.subject!==identity.subject
    ||d.role!==clientRole(identity,env)||!d.signingKey||!d.agreementKey)fail('DEVICE_NOT_AUTHORIZED',403);
  return {m,d};
}
export async function beginConnection(store,identity,id,authorization,env,now=Date.now){
  if(!deviceId(id))fail('INVALID_MESSAGE',400);const tokenDigest=await digest(authorization);
  return store.transaction(async tx=>{
    const {m,d}=await current(tx,identity,id,env),pending=await tx.list({prefix:'connect:'});
    if([...pending.values()].filter(r=>r.state==='pending'&&r.expiresAt>now()).length>=8)fail('CAPACITY',429);
    const r={id:random(),nonce:random(),account:{issuer:identity.issuer,subject:identity.subject},accountEpoch:m.accountEpoch,
      issuedAt:now(),expiresAt:Math.min(now()+30000,identity.expiresAt),clientId:identity.clientId,tokenDigest,device:publicDevice(d),state:'pending'};
    if(r.expiresAt<=now())fail('UNAUTHORIZED');await tx.put('connect:'+r.id,r);return r;
  },{validate:()=>{if(identity.expiresAt<=now())fail('UNAUTHORIZED');}});
}
export async function consumeConnection(store,request,identity,env,now=Date.now){
  const id=request.headers.get('X-Save-Asset-Challenge');
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('DEVICE_NOT_AUTHORIZED',403);
  let proof;try{proof=decodeBase64Url(request.headers.get('X-Save-Asset-Proof'),64);}catch{fail('DEVICE_NOT_AUTHORIZED',403);}
  if(proof.length!==64)fail('DEVICE_NOT_AUTHORIZED',403);
  const tokenDigest=await digest(request.headers.get('Authorization'));
  return store.transaction(async tx=>{
    const r=await tx.get('connect:'+id);
    if(!r||r.state!=='pending'||r.expiresAt<=now()||r.account.issuer!==identity.issuer||r.account.subject!==identity.subject
      ||r.clientId!==identity.clientId||r.tokenDigest!==tokenDigest)fail('DEVICE_NOT_AUTHORIZED',403);
    const {m,d}=await current(tx,identity,r.device.id,env);
    if(m.accountEpoch!==r.accountEpoch||!same(publicDevice(d),r.device))fail('DEVICE_NOT_AUTHORIZED',403);
    let valid=false;try{const key=await crypto.subtle.importKey('jwk',d.signingKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      valid=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,proof,connectionBytes(r));}catch{}
    if(!valid||r.expiresAt<=now()||identity.expiresAt<=now())fail('DEVICE_NOT_AUTHORIZED',403);
    await tx.put('connect:'+id,{...r,state:'consumed'});
    return {...identity,device:{id:d.id,role:d.role,version:d.version,keyId:d.keyId}};
  },{validate:()=>{if(identity.expiresAt<=now())fail('UNAUTHORIZED');}});
}
