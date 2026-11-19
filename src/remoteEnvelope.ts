/** Experimental native-core cryptographic adapter. Not imported by the app.
 * Requires separately trusted directory and non-exportable native private keys.
 * This candidate suite needs protocol review before production activation; it
 * does not claim forward secrecy or solve native key storage/provisioning.
 */
import { RemoteSyncError, sameRemoteAccount } from './remoteSyncProtocol';
import type { RelayCiphertext, RemoteDevice, VerifiedRemoteSender } from './remoteSnapshotRouter';
import { RemoteDeviceDirectory } from './remoteDeviceDirectory';
import type { PublicDevice } from './remoteDeviceDirectory';
const encode = new TextEncoder();
const text = new TextDecoder('utf-8', { fatal: true });
const bytes = (v: Uint8Array) => v as BufferSource;
const SUITE = 'save-asset-lab/P256-HKDF-SHA256-A256GCM-ECDSA/1';
const protocol = 'nioh-relay/1' as const;
const b64 = (v: Uint8Array) => btoa(Array.from(v, x => String.fromCharCode(x)).join('')).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
function unb64(v: string, maximum: number): Uint8Array {
  if (typeof v !== 'string' || v.length > Math.ceil(maximum*4/3) || !/^[A-Za-z0-9_-]+$/.test(v) || v.length%4===1) throw new RemoteSyncError('INVALID_MESSAGE');
  const result=Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-v.length%4)%4)), x=>x.charCodeAt(0));
  if (result.length>maximum || b64(result)!==v) throw new RemoteSyncError('INVALID_MESSAGE');
  return result;
}
function join(...values: Uint8Array[]): Uint8Array {
  const out=new Uint8Array(values.reduce((n,v)=>n+v.length,0)); let at=0;
  for(const v of values){out.set(v,at);at+=v.length;} return out;
}
export interface NativePrivateKeys { agreement: CryptoKey; signing: CryptoKey }
export class ExperimentalRemoteEnvelope {
  constructor(private readonly options?: { directory: RemoteDeviceDirectory; deviceId: string; keys: NativePrivateKeys; now(): number }) {}
  private devices(peerId: string): [PublicDevice, PublicDevice] {
    if(!this.options) throw new RemoteSyncError('NOT_CONFIGURED');
    const self=this.options.directory.get(this.options.deviceId), peer=this.options.directory.get(peerId);
    if(!self || !peer || self.state!=='active' || peer.state!=='active') throw new RemoteSyncError('REVOKED');
    if(self.id===peer.id || self.role===peer.role || !sameRemoteAccount(self.account,peer.account)) throw new RemoteSyncError('UNAUTHORIZED');
    return [self,peer];
  }
  private header(frame: Omit<RelayCiphertext,'ciphertext'>, from: PublicDevice, to: PublicDevice): Uint8Array {
    return encode.encode(JSON.stringify([SUITE,frame.protocol,from.account.issuer,from.account.subject,frame.requestId,
      from.id,from.version,from.keyId,to.id,to.version,to.keyId]));
  }
  private async key(peer: PublicDevice, salt: Uint8Array, header: Uint8Array): Promise<CryptoKey> {
    const publicKey=await crypto.subtle.importKey('jwk',peer.agreementKey,{name:'ECDH',namedCurve:'P-256'},false,[]);
    const secret=await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},this.options!.keys.agreement,256);
    const material=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveKey']);
    new Uint8Array(secret).fill(0);
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:bytes(salt),info:bytes(header)},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  private unchanged(before: [PublicDevice,PublicDevice]): void {
    const after=this.devices(before[1].id);
    if(JSON.stringify(after)!==JSON.stringify(before)) throw new RemoteSyncError('UNAUTHORIZED');
  }
  async seal(message: unknown, recipient: RemoteDevice): Promise<RelayCiphertext> {
    const pair=this.devices(recipient.id), [self,peer]=pair;
    if(peer.version!==recipient.version || peer.keyId!==recipient.keyId) throw new RemoteSyncError('UNAUTHORIZED');
    const captured=structuredClone(message) as {requestId?: string; expiresAt?: number};
    if(typeof captured?.requestId!=='string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(captured.requestId)
      || !Number.isSafeInteger(captured.expiresAt) || captured.expiresAt!<=this.options!.now()) throw new RemoteSyncError('STALE');
    const plain=encode.encode(JSON.stringify(captured));
    if(plain.length>(self.role==='app'?48*1024:4*1024*1024)) throw new RemoteSyncError('CAPACITY');
    const frame={protocol,requestId:captured.requestId,fromDeviceId:self.id,toDeviceId:peer.id};
    const header=this.header(frame,self,peer), salt=crypto.getRandomValues(new Uint8Array(32)), iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await this.key(peer,salt,header);
    const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(iv),additionalData:bytes(header),tagLength:128},key,bytes(plain)));
    const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},this.options!.keys.signing,bytes(join(header,salt,iv,cipher))));
    this.unchanged(pair);
    const wire=encode.encode(JSON.stringify([SUITE,b64(salt),b64(iv),b64(cipher),b64(signature)]));
    if(wire.length>(self.role==='app'?64*1024:6*1024*1024)) throw new RemoteSyncError('CAPACITY');
    // Normalize native TextEncoder/WebCrypto output into this adapter's realm.
    return {...frame,ciphertext:new Uint8Array(wire)};
  }
  sealAuthenticated(message: unknown, recipient: RemoteDevice): Promise<RelayCiphertext> { return this.seal(message,recipient); }
  async openAuthenticated(frame: RelayCiphertext): Promise<{sender:VerifiedRemoteSender;message:unknown}> {
    if(!this.options) throw new RemoteSyncError('NOT_CONFIGURED');
    try {
      const captured={...frame,ciphertext:frame.ciphertext.slice()};
      const pair=this.devices(captured.fromDeviceId),[self,peer]=pair;
      if(captured.protocol!==protocol || captured.toDeviceId!==self.id || !/^[A-Za-z0-9._:-]{1,160}$/.test(captured.requestId)
        || captured.ciphertext.length>(peer.role==='app'?64*1024:6*1024*1024)) throw new RemoteSyncError('INVALID_MESSAGE');
      const envelope=JSON.parse(text.decode(captured.ciphertext));
      if(!Array.isArray(envelope)||envelope.length!==5||envelope[0]!==SUITE) throw new RemoteSyncError('INVALID_MESSAGE');
      const salt=unb64(envelope[1],32),iv=unb64(envelope[2],12),cipher=unb64(envelope[3],4*1024*1024+16),signature=unb64(envelope[4],64);
      if(salt.length!==32||iv.length!==12||signature.length!==64||cipher.length<16) throw new RemoteSyncError('INVALID_MESSAGE');
      const header=this.header(captured,peer,self);
      const publicKey=await crypto.subtle.importKey('jwk',peer.signingKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,bytes(signature),bytes(join(header,salt,iv,cipher)))) throw new RemoteSyncError('UNAUTHORIZED');
      const key=await this.key(peer,salt,header);
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:bytes(header),tagLength:128},key,bytes(cipher));
      const message=JSON.parse(text.decode(plain)) as {requestId?:string;expiresAt?:number};
      this.unchanged(pair);
      if(message.requestId!==captured.requestId||!Number.isSafeInteger(message.expiresAt)||message.expiresAt!<=this.options.now()) throw new RemoteSyncError('STALE');
      return {sender:{account:structuredClone(peer.account),deviceId:peer.id,deviceVersion:peer.version,keyId:peer.keyId,
        authorizationExpiresAt:this.options.directory.expiresAt},message};
    } catch(e) { throw e instanceof RemoteSyncError?e:new RemoteSyncError('UNAUTHORIZED'); }
  }
}
