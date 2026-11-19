import {clientRoles} from './client-roles.js';
import { accountKey,authConfig,requireAccountPolicy,requireAllowedAccount,decodeBase64Url,deviceId,errorResponse,fail,RelayError } from './auth.js';
import { EnrollmentAuthority,EnrollmentError,EnrollmentService } from './enrollment.js';
import { EnrollmentStorage } from './enrollment-storage.js';
import {beginConnection} from './connect-proof.js';
export function requireEnrollmentConfigured(env){
  requireAccountPolicy(env);
  clientRoles(env);
  if(env.ENROLLMENT_ENABLED!=='true'||env.RELAY_ENABLED!=='true'||!env.ACCOUNT_RELAYS)fail('NOT_CONFIGURED',503);
}
const paths={
  '/v1/enrollment/connect/begin':['deviceId'],
  '/v1/enrollment/first-pc/begin':['candidate'],
  '/v1/enrollment/first-pc/finish':['id','signature'],
  '/v1/enrollment/phone/begin':['candidate'],
  '/v1/enrollment/phone/prove':['id','signature'],
  '/v1/enrollment/phone/decision':['id','decision','phrase','signature'],
  '/v1/enrollment/phone/withdraw':['id','signature'],
  '/v1/enrollment/revoke/begin':['deviceId'],
  '/v1/enrollment/revoke/finish':['id','signature']
};
export function requireEnrollmentRequest(request){
  const url=new URL(request.url);
  if(url.protocol!=='https:')fail('HTTPS_REQUIRED',403);
  if(request.headers.has('Origin'))fail('NATIVE_CLIENT_REQUIRED',403);
  if(url.search)fail('NOT_FOUND',404);
  const read=url.pathname==='/v1/enrollment/state'||url.pathname==='/v1/enrollment/devices'||url.pathname==='/v1/enrollment/pending'
    || /^\/v1\/enrollment\/requests\/[a-f0-9]{64}$/.test(url.pathname);
  if(!(read&&request.method==='GET'||paths[url.pathname]&&request.method==='POST'))fail('NOT_FOUND',404);
  if(request.method==='POST'&&request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail('INVALID_MESSAGE',400);
  if(request.method==='POST'&&Number(request.headers.get('Content-Length'))>16384)fail('MESSAGE_TOO_LARGE',413);
}
async function body(request){
  if(!request.body)fail('INVALID_MESSAGE',400);
  const reader=request.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)fail('MESSAGE_TOO_LARGE',413);chunks.push(value);}}
  finally{await reader.cancel();reader.releaseLock();}
  try{const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),keys=paths[new URL(request.url).pathname];
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())fail('INVALID_MESSAGE',400);
    if(keys.includes('id')&&(typeof value.id!=='string'||!/^[a-f0-9]{64}$/.test(value.id)))fail('INVALID_MESSAGE',400);
    return value;
  }catch(e){if(e instanceof RelayError)throw e;fail('INVALID_MESSAGE',400);}
}
const reply=value=>Response.json(value,{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const status=code=>({NOT_CONFIGURED:503,UNAUTHORIZED:401,EXPIRED:410,REPLAY:409,BUSY:409,CONFLICT:409,ALREADY_ENROLLED:409,DEVICE_ID_USED:409,CAPACITY:429,RATE_LIMITED:429})[code]??403;
export class EnrollmentRouter{
  constructor(ctx,env,{verifier,now=Date.now,invalidate=()=>{}}){
    this.ctx=ctx;this.env=env;this.now=now;this.invalidate=invalidate;
    this.authority=new EnrollmentAuthority({now,clients:clientRoles(env),
      verify:request=>verifier.verifyAccount(request,env)});
    this.store=new EnrollmentStorage(ctx.storage,{now,invalidate});
    this.service=new EnrollmentService({enabled:true,authority:this.authority,store:this.store,now});
  }
  async fetch(request){try{
    requireEnrollmentConfigured(this.env);requireEnrollmentRequest(request);
    // Account reads and registered-key admission need a live token, while each
    // sensitive service mutation still requires independently recent auth_time.
    const capability=await this.authority.authenticate(request),p=this.authority.resolve(capability,null,false);
    requireAllowedAccount(p,this.env);
    const key=await accountKey(p);
    if(this.ctx.id.toString()!==this.env.ACCOUNT_RELAYS.idFromName(key).toString())fail('UNAUTHORIZED');
    await this.store.transaction(async tx=>{
      const old=await tx.get('enrollment:rate'),rate=old&&this.now()>=old.start&&this.now()-old.start<60000?old:{start:this.now(),requests:0};
      if(rate.requests>=60)throw new EnrollmentError('RATE_LIMITED');
      await tx.put('enrollment:rate',{...rate,requests:rate.requests+1});
    });
    const path=new URL(request.url).pathname,s=this.service;
    if(path==='/v1/enrollment/state')return reply(await s.state(capability));
    if(path==='/v1/enrollment/pending')return reply(await s.transaction(capability,'pc',async(tx,identity)=>{
      const meta=await s.meta(tx,identity);await s.root(tx,identity,meta);
      const requests=[];for(const r of (await tx.list({prefix:'join:'})).values()){
        if(r.state!=='pending-approval'||r.expiresAt<=this.now())continue;
        await s.bound(tx,identity,r);requests.push(s.view(r));
      }
      return {requests};
    },{fresh:false}));
    if(path==='/v1/enrollment/devices')return reply(await s.transaction(capability,null,async(tx,identity)=>{
      await s.meta(tx,identity);return {devices:[...(await tx.list({prefix:'device:'})).values()].map(({registration,...d})=>d)};
    },{fresh:false}));
    if(path.startsWith('/v1/enrollment/requests/'))return reply(await s.transaction(capability,null,async(tx,identity)=>{
      const id=path.split('/').at(-1);let r=await tx.get('bootstrap');if(r?.id!==id)r=await tx.get('join:'+id)??await tx.get('revoke:'+id);
      s.fresh(r);await s.bound(tx,identity,r);return s.view(r);
    },{fresh:false}));
    const b=await body(request),proof=()=>decodeBase64Url(b.signature,64);let result;
    switch(path){
      case '/v1/enrollment/connect/begin':result=await beginConnection(this.store,p,b.deviceId,request.headers.get('Authorization'),this.env,this.now);break;
      case '/v1/enrollment/first-pc/begin':result=await s.beginFirstPc(capability,b.candidate);break;
      case '/v1/enrollment/first-pc/finish':result=await s.finishFirstPc(capability,b.id,proof());break;
      case '/v1/enrollment/phone/begin':result=await s.beginPhoneJoin(capability,b.candidate);break;
      case '/v1/enrollment/phone/prove':result=await s.provePhoneJoin(capability,b.id,proof());break;
      case '/v1/enrollment/phone/decision':result=await s.decidePhone(capability,b.id,b.decision,b.phrase,proof());break;
      case '/v1/enrollment/phone/withdraw':result=await s.withdrawPhone(capability,b.id,proof());break;
      case '/v1/enrollment/revoke/begin':result=await s.beginDeviceRevoke(capability,b.deviceId);break;
      case '/v1/enrollment/revoke/finish':result=await s.revokeDevice(capability,b.id,proof());break;
    }
    if(result?.state==='rejected'||result?.state==='cancelled'){
      const r=await this.ctx.storage.get('join:'+b.id);if(r)this.invalidate([r.candidate.id]);
    }
    return reply(result);
  }catch(e){return errorResponse(e instanceof EnrollmentError?new RelayError(e.code,status(e.code)):e);}}
}
