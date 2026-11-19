// Actual workerd integration; test-only subclass adds pause controls, no auth bypass.
import {createRequire} from 'node:module';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [toolRoot,output]=process.argv.slice(2),require=createRequire(join(toolRoot,'package.json')),{Miniflare}=require('miniflare');
const {enrollmentBytes,verificationPhrase}=await import(pathToFileURL(resolve('src/enrollment.js')));
const {connectionBytes}=await import(pathToFileURL(resolve('src/connect-proof.js')));
const {accountKey}=await import(pathToFileURL(resolve('src/auth.js')));
const results=[],log=message=>console.log(new Date().toISOString(),message),b64=x=>Buffer.from(x).toString('base64url');
let mf,phase='startup',jwksCalls=0;const sockets=[];
const watchdog=setTimeout(()=>{console.error('TIMEOUT '+phase);process.exit(2);},90000);
const issuer='https://synthetic-issuer.invalid/',audience='https://synthetic-relay.invalid/',now=Math.floor(Date.now()/1000);
const rsa=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
const publicRsa={...await crypto.subtle.exportKey('jwk',rsa.publicKey),kid:'synthetic-rsa',alg:'RS256',use:'sig'};
async function token(role,jti='one'){
 const payload={iss:issuer,sub:'synthetic-account',aud:audience,azp:'synthetic-'+role,scope:'relay:connect',iat:now,auth_time:now,exp:now+600,jti};
 const input=b64(JSON.stringify({alg:'RS256',typ:'JWT',kid:publicRsa.kid}))+'.'+b64(JSON.stringify(payload));
 return input+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',rsa.privateKey,new TextEncoder().encode(input)));
}
const tokens={pc:await token('pc'),app:await token('app')};
async function material(id){
 const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const agreement=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 const pub=async key=>{const {kty,crv,x,y}=await crypto.subtle.exportKey('jwk',key);return {kty,crv,x,y};};
 return {signing,candidate:{id,keyId:'key-'+id,signingKey:await pub(signing.publicKey),agreementKey:await pub(agreement.publicKey)}};
}
const pc=await material('pc-1'),phone=await material('phone-1'),phone2=await material('phone-2'),rejected=await material('rejected-phone');
const sign=async(r,purpose,who=pc)=>b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},who.signing.privateKey,enrollmentBytes(r,purpose)));
const signConnect=async(r,who)=>b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},who.signing.privateKey,connectionBytes(r)));
async function call(path,data,role='pc'){
 const response=await mf.dispatchFetch(audience+'v1/enrollment/'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+tokens[role],...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const value=await response.json();log('HTTP '+response.status+' '+path+' '+(value.state??value.error??'metadata'));return {status:response.status,value};
}
async function joinPhone(who,decision='approve'){
 const r=await call('phone/begin',{candidate:who.candidate},'app');assert.equal(r.status,200);
 assert.equal((await call('phone/prove',{id:r.value.id,signature:await sign(r.value,'phone-proof',who)},'app')).status,200);
 assert.equal((await call('phone/decision',{id:r.value.id,decision,phrase:await verificationPhrase(r.value),signature:await sign(r.value,'phone-'+decision)})).status,200);
 return r.value;
}
async function prepare(who,role){const r=await call('connect/begin',{deviceId:who.candidate.id},role);assert.equal(r.status,200);return {record:r.value,signature:await signConnect(r.value,who)};}
async function connect(proof,role,accessToken=tokens[role]){
 return mf.dispatchFetch(audience+'v1/connect',{headers:{Authorization:'Bearer '+accessToken,Upgrade:'websocket',...(proof?{'X-Save-Asset-Challenge':proof.record.id,'X-Save-Asset-Proof':proof.signature}:{})}});
}
function watch(response){assert.equal(response.status,101);const ws=response.webSocket;assert.ok(ws);const events={messages:[],closed:false};
 ws.addEventListener('message',event=>events.messages.push(event.data));ws.addEventListener('close',()=>{events.closed=true;});ws.accept();sockets.push(ws);return {ws,events};}
async function until(predicate,label){const end=Date.now()+4000;while(!predicate()){if(Date.now()>end)throw Error('wait timed out: '+label);await new Promise(r=>setTimeout(r,20));}}
async function revoke(id){const r=await call('revoke/begin',{deviceId:id});assert.equal(r.status,200);const done=await call('revoke/finish',{id:r.value.id,signature:await sign(r.value,'device-revoke')});assert.equal(done.status,200);}
async function check(name,callback){phase=name;log('BEGIN '+name);await callback();results.push({name,status:'passed'});log('PASS '+name);}
const src=join(output,'src'),names=['index.js',...(await readdir(src)).filter(n=>n.endsWith('.js')&&n!=='index.js')];
const modules=await Promise.all(names.map(async name=>({type:'ESModule',path:join(src,name),contents:await readFile(join(src,name),'utf8')})));
// Local-only instrumentation lives solely in this test module, never production.
const instrument=`import {AccountRelay} from './index.js';
export class TestAccountRelay extends AccountRelay {
 constructor(ctx,env){super(ctx,env);this.test={};
  const ledger=this.hub.ledger.bind(this.hub);this.hub.ledger=async(...args)=>{await ledger(...args);if(this.test.mode==='ledger')await this.pause();};
  const consume=this.hub.consume.bind(this.hub);this.hub.consume=async(...args)=>{await consume(...args);if(this.test.mode==='handshake'&&args[2])await this.pause();};
 }
 pause(){this.test.hit=true;return new Promise(resolve=>{this.test.release=resolve;});}
 async fetch(request){const path=new URL(request.url).pathname;
  if(path==='/__test/ledger'||path==='/__test/handshake'){this.test={mode:path.slice(8),hit:false};return Response.json({armed:true});}
  if(path==='/__test/state')return Response.json({hit:!!this.test.hit});
  if(path==='/__test/release'){this.test.mode=null;this.test.release?.();return Response.json({released:true});}
  return super.fetch(request);
 }
}
export {default} from './index.js';`;
modules.unshift({type:'ESModule',path:join(src,'test-entry.js'),contents:instrument});
await writeFile(join(output,'test-entry.js'),instrument);
try{
 log('START actual workerd, SQLite DO, all outbound intercepted');
 mf=new Miniflare({modules,modulesRoot:src,compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,cf:false,
  durableObjects:{ACCOUNT_RELAYS:{className:'TestAccountRelay',useSQLite:true}},durableObjectsPersist:join(output,'sqlite'),
  bindings:{AUTH0_ISSUER:issuer,AUTH0_AUDIENCE:audience,AUTH0_CLIENT_IDS:'synthetic-pc,synthetic-app',AUTH0_PC_CLIENT_ID:'synthetic-pc',AUTH0_APP_CLIENT_ID:'synthetic-app',AUTH0_DEVICE_CLAIM:'',RELAY_ENABLED:'true',ENROLLMENT_ENABLED:'true',DEVICE_DIRECTORY_READY:'true'},
  outboundService:async request=>{if(request.url!==issuer+'.well-known/jwks.json')throw Error('Outbound denied');jwksCalls++;return Response.json({keys:[publicRsa]});}});
 await mf.ready;log('READY actual workerd');
 const namespace=await mf.getDurableObjectNamespace('ACCOUNT_RELAYS'),id=await accountKey({issuer,subject:'synthetic-account'}),stub=namespace.get(namespace.idFromName(id));
 const control=async name=>(await stub.fetch('https://relay.internal/__test/'+name)).json();
 async function waitHit(){const end=Date.now()+4000;while(!(await control('state')).hit){if(Date.now()>end)throw Error('barrier not reached');await new Promise(r=>setTimeout(r,20));}}
 await check('concurrent first-device begin and finish commit exactly one root',async()=>{
  const starts=await Promise.all([call('first-pc/begin',{candidate:pc.candidate}),call('first-pc/begin',{candidate:phone2.candidate})]);
  assert.deepEqual(starts.map(r=>r.status).sort(),[200,409]);const r=starts.find(r=>r.status===200).value;
  // Use the winner's actual signing key; no assumed scheduling order.
  const who=r.candidate.id===pc.candidate.id?pc:phone2;
  const payload={id:r.id,signature:await sign(r,'first-pc',who)},finishes=await Promise.all([call('first-pc/finish',payload),call('first-pc/finish',payload)]);
  assert.deepEqual(finishes.map(r=>r.status).sort(),[200,409]);assert.equal((await call('devices')).value.devices.length,1);
  if(who!==pc){pc.candidate=who.candidate;pc.signing=who.signing;phone2.candidate={...phone2.candidate,id:'phone-2-new',keyId:'key-phone-2-new'};}
 });
 await check('rejected phone cannot obtain proof challenge or handshake',async()=>{
  await joinPhone(rejected,'reject');assert.equal((await call('connect/begin',{deviceId:rejected.candidate.id},'app')).status,403);
  assert.equal((await connect(null,'app')).status,403);
 });
 let pcSocket,phoneSocket,spentProof;
 await check('registered-key proof opens real WebSockets without any device JWT claim',async()=>{
  await joinPhone(phone);pcSocket=watch(await connect(await prepare(pc,'pc'),'pc'));spentProof=await prepare(phone,'app');phoneSocket=watch(await connect(spentProof,'app'));
  phoneSocket.ws.send('ping');await until(()=>phoneSocket.events.messages.includes('pong'),'real pong');
 });
 await check('proof replay, wrong signing key and token substitution cannot connect',async()=>{
  assert.equal((await connect(spentProof,'app')).status,403);
  const fresh=await prepare(phone,'app'),wrong={...fresh,signature:await signConnect(fresh.record,pc)};
  assert.equal((await connect(wrong,'app')).status,403);
  assert.equal((await connect(fresh,'app',await token('app','different-token'))).status,403);
 });
 await check('revocation closes real socket and final output gate blocks paused forwarding',async()=>{
  const late=await prepare(phone,'app');await control('ledger');
  phoneSocket.ws.send(JSON.stringify({protocol:'nioh-relay/1',requestId:'paused-forward',fromDeviceId:phone.candidate.id,toDeviceId:pc.candidate.id,ciphertext:'AQ'}));
  await waitHit();await revoke(phone.candidate.id);await until(()=>phoneSocket.events.closed,'revoked socket close');await control('release');
  phoneSocket.ws.close();assert.equal((await connect(late,'app')).status,403);
  assert.equal((await call('connect/begin',{deviceId:phone.candidate.id},'app')).status,403);
  await new Promise(r=>setTimeout(r,100));assert.equal(pcSocket.events.messages.some(m=>String(m).includes('paused-forward')),false);
 });
 await check('revocation racing verified handshake prevents stale socket acceptance',async()=>{
  await joinPhone(phone2);const proof=await prepare(phone2,'app');await control('handshake');const pending=connect(proof,'app');
  await waitHit();await revoke(phone2.candidate.id);await control('release');assert.equal((await pending).status,403);
 });
}catch(error){results.push({name:phase,status:'failed',error:String(error),stack:error.stack});log('FAIL '+phase+' '+error);}
finally{for(const socket of sockets)try{socket.close();}catch{}if(mf){log('DISPOSE workerd');await mf.dispose();}clearTimeout(watchdog);}
const report={status:results.some(r=>r.status==='failed')?'failed':'passed',runtime:'actual Miniflare/workerd + SQLite + real WebSockets',compatibilityDate:'2026-07-30',productionTemplateDate:'2026-10-15',jwksCalls,externalRequests:0,tests:results.length,passed:results.filter(r=>r.status==='passed').length,results,testInstrumentation:'local-only subclass pauses ledger/handshake; no authentication bypass',hibernationTested:false,platformRollbackOutputGateTested:false};
await writeFile(join(output,'result.json'),JSON.stringify(report,null,2)+'\n');log(JSON.stringify(report));process.exitCode=report.status==='passed'?0:1;
