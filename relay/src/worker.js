import { accountKey, authConfig, requireAllowedAccount, errorResponse, fail, productionVerifier } from './auth.js';
import { requireEnrollmentConfigured, requireEnrollmentRequest } from './enrollment-routes.js';

export function requireConfigured(env) {
  authConfig(env,false);
  if (env.RELAY_ENABLED !== 'true' || env.DEVICE_DIRECTORY_READY !== 'true' || !env.ACCOUNT_RELAYS) fail('NOT_CONFIGURED', 503);
}
export function requireUpgrade(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:') fail('HTTPS_REQUIRED', 403);
  // Bearer tokens are accepted only in native Authorization headers, never URLs.
  if (url.search || url.pathname !== '/v1/connect') fail('NOT_FOUND', 404);
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') fail('UPGRADE_REQUIRED', 426);
  if (request.headers.has('Origin')) fail('NATIVE_CLIENT_REQUIRED', 403);
}
export function createWorker(verifier = productionVerifier) {
  return { async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET' && !url.search) {
        let ready = true; try { requireConfigured(env); } catch { ready = false; }
        return Response.json({ service: 'save-asset-relay', status: ready ? 'configured' : 'configuration-required' },
          { headers: { 'Cache-Control': 'no-store' } });
      }
      const enrollment=url.pathname.startsWith('/v1/enrollment/');
      if(enrollment){requireEnrollmentConfigured(env);requireEnrollmentRequest(request);}
      else {requireConfigured(env); requireUpgrade(request);}
      const identity = await verifier.verifyAccount(request,env);
      requireAllowedAccount(identity,env);
      const id = env.ACCOUNT_RELAYS.idFromName(await accountKey(identity));
      // The DO independently re-verifies the token. Client identity headers are unused.
      const headers = new Headers({ Authorization: request.headers.get('Authorization') });
      if(enrollment){if(request.headers.has('Content-Type'))headers.set('Content-Type',request.headers.get('Content-Type'));}
      else {headers.set('Upgrade','websocket');for(const name of ['X-Save-Asset-Challenge','X-Save-Asset-Proof'])if(request.headers.has(name))headers.set(name,request.headers.get(name));}
      return await env.ACCOUNT_RELAYS.get(id).fetch(new Request('https://relay.internal'+url.pathname,
        {method:request.method,headers,...(enrollment && request.method==='POST'?{body:request.body,duplex:'half'}:{})}));
    } catch (e) { return errorResponse(e); }
  } };
}
export default createWorker();
