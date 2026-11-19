import { issuer,context } from './fixture.mjs';
import { enrollmentFixture } from './enrollment.fixture.mjs';
import { AccountHub } from '../src/hub.js';
import { createWorker } from '../src/worker.js';
import { accountKey } from '../src/auth.js';
import { verificationPhrase } from '../src/enrollment.js';
import {connectionBytes} from '../src/connect-proof.js';
export async function routedFixture(freshClaim='auth_time',overrides={}){
  const auth=await issuer(),material=await enrollmentFixture(),c=await context(auth),partitions=new Map();
  c.storage.values.clear();
  const env={...c.env,ENROLLMENT_ENABLED:'true',AUTH0_PC_CLIENT_ID:'windows-client',AUTH0_APP_CLIENT_ID:'android-client'};
  env.AUTH0_FRESH_AUTH_CLAIM=freshClaim;Object.assign(env,overrides);
  const hub=new AccountHub(c.ctx,env,c.options);
  const key=await accountKey({issuer:env.AUTH0_ISSUER,subject:'unit-account'});
  partitions.set(key,{...c,hub});
  env.ACCOUNT_RELAYS={idFromName:name=>({toString:()=>name}),get:id=>({fetch:async request=>{
    let target=partitions.get(id.toString());
    if(!target){const other=await context(auth,'other-account');other.storage.values.clear();
      target={...other,hub:new AccountHub(other.ctx,env,other.options)};partitions.set(id.toString(),target);}
    return target.hub.fetch(request);
  }})};
  const worker=createWorker(auth.verifier);
  const request=async(path,data,{role='pc',sub='unit-account',claims={},token,origin}={})=>{
    const payload={...auth.claims(),[env.AUTH0_DEVICE_CLAIM]:undefined,[freshClaim]:Math.floor(auth.now()/1000),
      sub,azp:role==='pc'?'windows-client':'android-client',...claims};
    const headers={Authorization:'Bearer '+(token??await auth.token(payload))};
    if(origin)headers.Origin=origin;
    if(data!==undefined)headers['Content-Type']='application/json';
    return new Request('https://relay.example'+path,{method:data===undefined?'GET':'POST',headers,...(data===undefined?{}:{body:JSON.stringify(data)})});
  };
  const call=async(path,data,options)=>{const response=await worker.fetch(await request('/v1/enrollment/'+path,data,options),env);return {status:response.status,body:await response.json()};};
  const sign=async(r,purpose,who=material.pc)=>Buffer.from(await material.sign(r,purpose,who)).toString('base64url');
  const bootstrap=async()=>{const {body:r}=await call('first-pc/begin',{candidate:material.pc.candidate});
    const done=await call('first-pc/finish',{id:r.id,signature:await sign(r,'first-pc')});return {record:r,...done};};
  const join=async()=>{const {body:r}=await call('phone/begin',{candidate:material.phone.candidate},{role:'app'});
    const proof=await call('phone/prove',{id:r.id,signature:await sign(r,'phone-proof',material.phone)},{role:'app'});return {record:r,...proof};};
  const decide=async(r,decision='approve',options)=>call('phone/decision',{id:r.id,decision,phrase:await verificationPhrase(r),signature:await sign(r,'phone-'+decision)},options);
  const connect=async(who='pc',options={})=>{
    const d=who==='pc'?material.pc.candidate:material.phone.candidate;
    const begin=await request('/v1/enrollment/connect/begin',{deviceId:d.id},{...options,role:who});
    const response=await worker.fetch(begin,env);if(response.status!==200)return response;
    const challenge=await response.json(),key=who==='pc'?material.pc:material.phone;
    const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.signing.privateKey,connectionBytes(challenge));
    return worker.fetch(new Request('https://relay.example/v1/connect',{headers:{Authorization:begin.headers.get('Authorization'),Upgrade:'websocket',
      'X-Save-Asset-Challenge':challenge.id,'X-Save-Asset-Proof':Buffer.from(signature).toString('base64url')}}),env);
  };
  return {auth,material,...c,env,hub,partitions,worker,request,call,sign,bootstrap,join,decide,connect};
}
