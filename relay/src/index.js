import { DurableObject } from 'cloudflare:workers';
import worker from './worker.js';
import { AccountHub } from './hub.js';

export class AccountRelay extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.hub = new AccountHub(ctx, env); }
  fetch(request) { return this.hub.fetch(request); }
  webSocketMessage(ws, message) { return this.hub.webSocketMessage(ws, message); }
  webSocketClose(ws, code) { return this.hub.webSocketClose(ws, code); }
  webSocketError(ws) { return this.hub.webSocketError(ws); }
  alarm() { return this.hub.alarm(); }
}
export default worker;
