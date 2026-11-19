/** Offline integration core, intentionally not wired into Windows/Android UI.
 * Platform adapters must perform authenticated native WebSocket handshakes and
 * supply a native lease. This interface never accepts bearer tokens from JS.
 */
import { RemoteSyncError, sameRemoteAccount } from './remoteSyncProtocol';
import type { RemoteAccount, RemoteSnapshotRequest } from './remoteSyncProtocol';
import { RemoteSnapshotRouter } from './remoteSnapshotRouter';
import type { RelayCiphertext } from './remoteSnapshotRouter';
import { RemoteSnapshotReceiver } from './remoteSnapshotCache';
import type { RemoteCommitResult } from './remoteSnapshotCache';
import { ExperimentalRemoteEnvelope } from './remoteEnvelope';
import { RemoteDeviceDirectory } from './remoteDeviceDirectory';

export interface NativeRelayPort {
  connect(endpoint: string, receive: (frame: RelayCiphertext) => Promise<void>, closed: () => void): Promise<{ send(frame: RelayCiphertext): Promise<void>; close(): void }>;
}
export interface ConnectorOptions {
  laboratory: true; endpoint: string; account: RemoteAccount; deviceId: string;
  directory: RemoteDeviceDirectory; security: ExperimentalRemoteEnvelope; transport: NativeRelayPort;
  lease(): { account: RemoteAccount; deviceId: string; role: 'pc'|'app'; version: number; keyId: string; expiresAt: number } | null;
  now(): number;
}
type Socket = Awaited<ReturnType<NativeRelayPort['connect']>>;
class Connector {
  protected epoch=0;
  protected socket: Socket | null=null;
  private connecting=false;
  constructor(protected readonly options?:ConnectorOptions) {}
  protected configured():ConnectorOptions {
    const o=this.options;
    if(!o || o.laboratory!==true) throw new RemoteSyncError('NOT_CONFIGURED');
    const url=new URL(o.endpoint);
    if(url.protocol!=='wss:'||url.pathname!=='/v1/connect'||url.search||url.hash||url.username||url.password) throw new RemoteSyncError('NOT_CONFIGURED');
    return o;
  }
  protected live(epoch=this.epoch):ConnectorOptions {
    const o=this.configured(),lease=o.lease(),device=o.directory.get(o.deviceId);
    if(epoch!==this.epoch||!lease||!Number.isSafeInteger(lease.expiresAt)||lease.expiresAt<=o.now()||lease.deviceId!==o.deviceId||!sameRemoteAccount(lease.account,o.account)
      ||!device||device.state!=='active'||lease.role!==device.role||lease.version!==device.version||lease.keyId!==device.keyId
      ||!sameRemoteAccount(device.account,o.account)) throw new RemoteSyncError('UNAUTHORIZED');
    return o;
  }
  protected async open(role:'pc'|'app', receive:(f:RelayCiphertext,epoch:number)=>Promise<void>):Promise<void> {
    const o=this.live();
    if(this.connecting||this.socket) throw new RemoteSyncError('UNAVAILABLE');
    if(o.directory.get(o.deviceId)?.role!==role) throw new RemoteSyncError('UNAUTHORIZED');
    this.connecting=true;const epoch=++this.epoch;
    try {
      const socket=await o.transport.connect(o.endpoint, async f=>{
        try {this.live(epoch);await receive({...f,ciphertext:f.ciphertext.slice()},epoch);}
        catch {this.close();}
      },()=>{if(epoch===this.epoch)this.close();});
      try {this.live(epoch);} catch(e){socket.close();throw e;}
      this.socket=socket;
    } finally {if(epoch===this.epoch)this.connecting=false;}
  }
  close():void {this.epoch++;this.connecting=false;const socket=this.socket;this.socket=null;try{socket?.close();}catch{/* Cleanup must still invalidate readers. */}}
}
export class WindowsPublicationConnector extends Connector {
  constructor(options?:ConnectorOptions,private readonly router?:RemoteSnapshotRouter){super(options);router?.bindNativeAuthorizationGuard(()=>{this.live();});}
  async connect():Promise<void> {
    if(!this.router) throw new RemoteSyncError('NOT_CONFIGURED');
    this.router.beginConnect();
    try {
      await this.open('pc',async(frame,epoch)=>{
        const sealed=await this.router!.handle(frame);this.live(epoch);
        if(!this.socket) throw new RemoteSyncError('OFFLINE');
        await this.socket.send(sealed);this.live(epoch);
      });
      this.router.connected();
    } catch(e){this.close();throw e;}
  }
  override close():void {super.close();this.router?.disconnected();}
}
export class AndroidSnapshotConnector extends Connector {
  private pending=new Map<string,{resolve(v:RemoteCommitResult):void;reject(e:unknown):void;timer:ReturnType<typeof setTimeout>}>();
  constructor(options?:ConnectorOptions,private readonly receiver?:RemoteSnapshotReceiver){super(options);receiver?.bindNativeAuthorizationGuard(()=>{this.live();});}
  async connect():Promise<void> {
    if(!this.receiver) throw new RemoteSyncError('NOT_CONFIGURED');
    await this.open('app',async(frame,epoch)=>{
      const p=this.pending.get(frame.requestId);
      if(!p) throw new RemoteSyncError('UNAUTHORIZED');
      try {const value=await this.receiver!.receive(frame);this.live(epoch);p.resolve(value);}
      catch(e){p.reject(e);throw e;}
      finally {clearTimeout(p.timer);this.pending.delete(frame.requestId);}
    });
    this.receiver.setOnline(true);
  }
  async pull(value:RemoteSnapshotRequest):Promise<RemoteCommitResult> {
    const o=this.live(),epoch=this.epoch,request=structuredClone(value);
    if(!this.socket||!this.receiver) throw new RemoteSyncError('OFFLINE');
    if(this.pending.has(request.requestId))throw new RemoteSyncError('REPLAY');
    this.receiver.beginRequest(request);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(request.requestId);reject(new RemoteSyncError('STALE'));this.close();},Math.max(0,request.expiresAt-o.now()));
      this.pending.set(request.requestId,{resolve,reject,timer});
      void(async()=>{
        try {
          const pc=o.directory.get(request.toDeviceId);
          if(!pc)throw new RemoteSyncError('REVOKED');
          const sealed=await o.security.seal(request,pc);this.live(epoch);
          if(!this.socket)throw new RemoteSyncError('OFFLINE');
          await this.socket.send(sealed);this.live(epoch);
        } catch(e){const p=this.pending.get(request.requestId);if(p){clearTimeout(p.timer);this.pending.delete(request.requestId);p.reject(e);}this.close();}
      })();
    });
  }
  override close():void {
    super.close();this.receiver?.deactivate();
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new RemoteSyncError('OFFLINE'));}this.pending.clear();
  }
}
