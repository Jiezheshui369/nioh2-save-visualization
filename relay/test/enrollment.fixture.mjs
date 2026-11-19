import { EnrollmentAuthority,EnrollmentService,enrollmentBytes,verificationPhrase } from '../src/enrollment.js';
import { MemoryStorage,NOW } from './fixture.mjs';

async function material(id) {
  // Ephemeral synthetic private keys never leave RAM or enter storage.
  const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const agreement=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
  const pub=async key=>{const {kty,crv,x,y}=await crypto.subtle.exportKey('jwk',key);return {kty,crv,x,y};};
  return {signing,candidate:{id,keyId:'key-'+id,signingKey:await pub(signing.publicKey),agreementKey:await pub(agreement.publicKey)}};
}
export async function enrollmentFixture() {
  let now=NOW;
  const pc=await material('pc-1'),phone=await material('phone-1'),otherPhone=await material('phone-2');
  // This is explicitly a test OIDC dependency, not Auth0 acceptance evidence.
  const authority=new EnrollmentAuthority({now:()=>now,clients:{'pc-client':'pc','app-client':'app'},verify:async token=>({
    issuer:'https://issuer.example/',subject:token.includes('other')?'other-account':'unit-account',
    clientId:token.startsWith('pc')?'pc-client':'app-client',expiresAt:token.includes('short')?NOW+10:NOW+3600000,
    authenticatedAt:token.includes('old')?NOW-600000:NOW})});
  const pcAccount=await authority.authenticate('pc'),phoneAccount=await authority.authenticate('app');
  const store=new MemoryStorage(),service=new EnrollmentService({enabled:true,authority,store,now:()=>now});
  const sign=async(record,purpose,who=pc)=>new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},who.signing.privateKey,enrollmentBytes(record,purpose)));
  const bootstrap=async()=>{const r=await service.beginFirstPc(pcAccount,pc.candidate);await service.finishFirstPc(pcAccount,r.id,await sign(r,'first-pc'));return r;};
  const join=async()=>{const r=await service.beginPhoneJoin(phoneAccount,phone.candidate);await service.provePhoneJoin(phoneAccount,r.id,await sign(r,'phone-proof',phone));return r;};
  const approve=async r=>service.decidePhone(pcAccount,r.id,'approve',await verificationPhrase(r),await sign(r,'phone-approve'));
  return {service,authority,store,pcAccount,phoneAccount,pc,phone,otherPhone,sign,bootstrap,join,approve,advance:ms=>{now+=ms;},now:()=>now};
}
