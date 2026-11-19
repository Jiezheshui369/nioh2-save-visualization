import { createHash, webcrypto } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteDeviceDirectory, directoryBytes } from './remoteDeviceDirectory';
import type { DirectorySnapshot, PublicDevice } from './remoteDeviceDirectory';
import { ExperimentalRemoteEnvelope } from './remoteEnvelope';
import { AndroidSnapshotConnector, WindowsPublicationConnector } from './remoteConnectors';
import type { ConnectorOptions, NativeRelayPort } from './remoteConnectors';
import { RemoteSnapshotRouter } from './remoteSnapshotRouter';
import type { RelayCiphertext } from './remoteSnapshotRouter';
import { IndexedDbRemoteSnapshotCache, RemoteSnapshotReceiver } from './remoteSnapshotCache';
import type { RemoteSnapshotRequest } from './remoteSyncProtocol';
import type { SaveSnapshot } from './types';

beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('indexedDB',new IDBFactory());});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const account={issuer:'https://issuer.example/',subject:'synthetic-account'};
const hash=async(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const snapshot:SaveSnapshot={schemaVersion:'1.0.0',game:'Nioh 2',platform:'Steam',snapshotId:'synthetic-encrypted-flow',
  sourceLastWriteLocal:'2001-02-03T00:00:00Z',safety:{sourceOpenedReadOnly:true,parsedFromCopy:true,originalMainSaveSha256:'private-test-hash',originalHashUnchangedAfterProcessing:true},
  character:{level:17,amrita:0,gold:0,attributes:{constitution:1,heart:2,courage:3,stamina:4,strength:5,skill:6,dexterity:7,magic:8},proficiency:{}},
  currentLoadout:[],inventorySummary:{equipmentRecords:0,equipmentUnknownIds:0,equipmentByType:{},stackedItemRecords:0,scrollRecordsDetected:0},limitations:[]};
async function pair(name:'ECDH'|'ECDSA') {return await crypto.subtle.generateKey({name,namedCurve:'P-256'},false,name==='ECDH'?['deriveBits']:['sign','verify']) as CryptoKeyPair;}
async function publicKey(key:CryptoKey) {const j=await crypto.subtle.exportKey('jwk',key);return {kty:j.kty,crv:j.crv,x:j.x,y:j.y};}
async function fixture(subject=account.subject) {
  let now=1_800_000_000_000;
  const identity={...account,subject},signer=await pair('ECDSA');
  const pc={agreement:await pair('ECDH'),signing:await pair('ECDSA')},app={agreement:await pair('ECDH'),signing:await pair('ECDSA')};
  const device=async(id:string,role:'pc'|'app',keys:typeof pc):Promise<PublicDevice>=>({id,role,account:identity,version:1,keyId:'key-'+id,state:'active',
    agreementKey:await publicKey(keys.agreement.publicKey),signingKey:await publicKey(keys.signing.publicKey)});
  const devices=[await device('pc-1','pc',pc),await device('app-1','app',app)];
  const directory=new RemoteDeviceDirectory({account:identity,signer:signer.publicKey,now:()=>now});
  const sign=async(s:DirectorySnapshot)=>new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signer.privateKey,directoryBytes(s) as BufferSource));
  const initial:DirectorySnapshot={schema:'save-asset-directory/1',account:identity,revision:1,issuedAt:now,expiresAt:now+60_000,devices};
  await directory.accept(initial,await sign(initial));
  const security=(id:string,keys:typeof pc)=>new ExperimentalRemoteEnvelope({directory,deviceId:id,keys:{agreement:keys.agreement.privateKey,signing:keys.signing.privateKey},now:()=>now});
  const pcSecurity=security('pc-1',pc),appSecurity=security('app-1',app);
  const request=(id='request-1'):RemoteSnapshotRequest=>({protocol:'nioh-relay/1',account:identity,requestId:id,fromDeviceId:'app-1',toDeviceId:'pc-1',
    fromDeviceVersion:1,toDeviceVersion:1,issuedAt:now,expiresAt:now+30_000,type:'snapshot.read',gameId:'nioh2',knownSnapshotId:null,knownRevision:null});
  return {identity,directory,initial,devices,sign,pcSecurity,appSecurity,request,now:()=>now,advance:(ms:number)=>{now+=ms;}};
}
describe('signed device directory',()=>{
  it('fails closed without a pinned authority; login identity alone cannot enroll',async()=>{
    const f=await fixture();await expect(new RemoteDeviceDirectory().accept(f.initial,await f.sign(f.initial))).rejects.toMatchObject({code:'NOT_CONFIGURED'});
    const altered=structuredClone(f.initial);altered.devices[0].agreementKey.x='A'.repeat(43);
    await expect(f.directory.accept({...altered,revision:2},await f.sign(f.initial))).rejects.toMatchObject({code:'UNAUTHORIZED'});
  });
  it('rejects another account even when its directory is signed by the pinned signer',async()=>{
    const f=await fixture();const s={...f.initial,revision:2,account:{...account,subject:'another-account'}};
    await expect(f.directory.accept(s,await f.sign(s))).rejects.toMatchObject({code:'UNAUTHORIZED'});
  });
  it('prevents rollback, revocation reversal and reuse after expiry',async()=>{
    const f=await fixture();await expect(f.directory.accept(f.initial,await f.sign(f.initial))).rejects.toMatchObject({code:'UNAUTHORIZED'});
    const revoked=structuredClone(f.initial);revoked.revision=2;revoked.devices[0].state='revoked';await f.directory.accept(revoked,await f.sign(revoked));
    const restored={...f.initial,revision:3};await expect(f.directory.accept(restored,await f.sign(restored))).rejects.toMatchObject({code:'UNAUTHORIZED'});
    f.advance(60_001);expect(f.directory.get('app-1')).toBeNull();
  });
  it('does not expose mutable references and preserves revision after logout invalidation',async()=>{
    const f=await fixture();f.directory.get('pc-1')!.state='revoked';expect(f.directory.get('pc-1')!.state).toBe('active');
    f.directory.invalidate();expect(f.directory.get('pc-1')).toBeNull();await expect(f.directory.accept(f.initial,await f.sign(f.initial))).rejects.toMatchObject({code:'UNAUTHORIZED'});
  });
});
describe('candidate authenticated encryption',()=>{
  it('uses real crypto and binds ciphertext to account, recipient and request',async()=>{
    const f=await fixture(),request=f.request(),frame=await f.appSecurity.seal(request,f.directory.get('pc-1')!);
    expect(new TextDecoder().decode(frame.ciphertext)).not.toContain('snapshot.read');
    expect((await f.pcSecurity.openAuthenticated(frame)).message).toEqual(request);
    for(const altered of [{...frame,requestId:'other-request'},{...frame,toDeviceId:'app-1'}])await expect(f.pcSecurity.openAuthenticated(altered)).rejects.toBeDefined();
    const other=await fixture('another-account');await expect(other.pcSecurity.openAuthenticated(frame)).rejects.toBeDefined();
  });
  it('rejects modified ciphertext, revoked keys and expired messages',async()=>{
    const f=await fixture(),frame=await f.appSecurity.seal(f.request(),f.directory.get('pc-1')!);
    const changed={...frame,ciphertext:frame.ciphertext.slice()};changed.ciphertext[50]^=1;
    await expect(f.pcSecurity.openAuthenticated(changed)).rejects.toBeDefined();
    f.advance(30_001);await expect(f.pcSecurity.openAuthenticated(frame)).rejects.toMatchObject({code:'STALE'});
    const revoked=structuredClone(f.initial);revoked.revision=2;revoked.devices[1].state='revoked';await f.directory.accept(revoked,await f.sign(revoked));
    await expect(f.pcSecurity.openAuthenticated(frame)).rejects.toMatchObject({code:'REVOKED'});
  });
});

async function flow(){
  const f=await fixture(),cache=new IndexedDbRemoteSnapshotCache();
  // Each endpoint has only its own private keys.
  const appReceiver=new RemoteSnapshotReceiver({enabled:true,issuer:account.issuer,account:f.identity,appDeviceId:'app-1',directory:f.directory,security:f.appSecurity,sha256:hash,now:f.now,cache});
  const read=vi.fn(async()=>({snapshot,publicationVersion:1}));
  const router=new RemoteSnapshotRouter({enabled:true,issuer:account.issuer,pcDeviceId:'pc-1',directory:f.directory,security:f.pcSecurity,readLatestSnapshot:read,sha256:hash,now:f.now});
  const endpoints=new Map<string,(frame:RelayCiphertext)=>Promise<void>>(),wire:RelayCiphertext[]=[];
  const port=(self:string,peer:string):NativeRelayPort=>({connect:async(_url,receive)=>{endpoints.set(self,receive);return {
    send:async frame=>{wire.push(structuredClone(frame));const receive=endpoints.get(peer);if(!receive)throw new Error('offline');await receive(frame);},
    close:()=>{endpoints.delete(self);}};}});
  let lease=true;
  const options=(id:string,peer:string,security:ExperimentalRemoteEnvelope):ConnectorOptions=>({laboratory:true,endpoint:'wss://relay.invalid/v1/connect',account:f.identity,deviceId:id,directory:f.directory,security,
    transport:port(id,peer),lease:()=>lease?{account:f.identity,deviceId:id,role:id==='pc-1'?'pc':'app',version:1,keyId:'key-'+id,expiresAt:f.now()+60_000}:null,now:f.now});
  const pc=new WindowsPublicationConnector(options('pc-1','app-1',f.pcSecurity),router);
  const app=new AndroidSnapshotConnector(options('app-1','pc-1',f.appSecurity),appReceiver);
  await pc.connect();await app.connect();appReceiver.selectPc('pc-1');
  return {...f,pc,app,receiver:appReceiver,cache,read,wire,endpoints,logout:()=>{lease=false;}};
}
describe('offline native-port contract integration (no real socket)',()=>{
  it('routes a genuinely encrypted request through the existing publication router',async()=>{
    const f=await fixture();
    const router=new RemoteSnapshotRouter({enabled:true,issuer:account.issuer,pcDeviceId:'pc-1',directory:f.directory,security:f.pcSecurity,
      readLatestSnapshot:async()=>({snapshot,publicationVersion:1}),sha256:hash,now:f.now});
    router.beginConnect();router.connected();
    const request=await f.appSecurity.seal(f.request(),f.directory.get('pc-1')!);
    const reply=await router.handle(request);
    expect((await f.appSecurity.openAuthenticated(reply)).message).toMatchObject({outcome:'snapshot'});
  });
  it('manually pulls through encryption and commits a redacted snapshot to IndexedDB',async()=>{
    const f=await flow();try {
      expect(f.read).not.toHaveBeenCalled();const result=await f.app.pull(f.request());expect(result.status).toBe('saved');
      const saved=await f.receiver.loadOffline();expect(saved?.snapshot.character.level).toBe(17);
      expect(saved?.snapshot.safety.originalMainSaveSha256).not.toBe('private-test-hash');expect(f.wire).toHaveLength(2);
      for(const frame of f.wire)expect(new TextDecoder().decode(frame.ciphertext)).not.toContain('synthetic-encrypted-flow');
    }finally{f.app.close();f.pc.close();}
  });
  it('rejects replay before a second publication read',async()=>{
    const f=await flow();try{
      await f.app.pull(f.request());await f.endpoints.get('pc-1')!(f.wire[0]);expect(f.read).toHaveBeenCalledTimes(1);
      expect(f.endpoints.has('pc-1')).toBe(false);
    }finally{f.app.close();f.pc.close();}
  });
  it('rejects expired native authorization and leaves saved offline data intact',async()=>{
    const f=await flow();try{
      await f.app.pull(f.request());f.logout();await expect(f.app.pull(f.request('request-2'))).rejects.toMatchObject({code:'UNAUTHORIZED'});
      expect((await f.cache.load({account:f.identity,appDeviceId:'app-1',pcDeviceId:'pc-1'}))?.snapshot.character.level).toBe(17);
    }finally{f.app.close();f.pc.close();}
  });
  it('has no working default configuration or implicit connection',async()=>{
    await expect(new WindowsPublicationConnector().connect()).rejects.toMatchObject({code:'NOT_CONFIGURED'});
    await expect(new AndroidSnapshotConnector().connect()).rejects.toMatchObject({code:'NOT_CONFIGURED'});
  });
  it('aborts an actual IndexedDB write when native authorization disappears during commit',async()=>{
    const f=await flow();const put=IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<typeof put>){
      const request=put.apply(this,args);f.logout();return request;
    });
    try{
      await expect(f.app.pull(f.request())).rejects.toBeDefined();
      expect(await f.cache.load({account:f.identity,appDeviceId:'app-1',pcDeviceId:'pc-1'})).toBeNull();
    }finally{f.app.close();f.pc.close();}
  });
});
