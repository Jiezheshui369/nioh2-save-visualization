// EXPORT REVIEW ARTIFACT ONLY. Synthetic client IDs; do not deploy this copy.
// Existing tenant Action is managed separately; this package does not change it.
// Google-only: time of Auth0's verified upstream federation, NOT a claim that
// the user re-entered their Google password or completed Google MFA.
const CLAIM='https://review-relay.invalid/claims/authenticated_at';
const AUDIENCE='https://review-relay.invalid';
const CLIENTS=['SYNC_EXAMPLE_WINDOWS_CLIENT','SYNC_EXAMPLE_ANDROID_CLIENT','SYNC_EXAMPLE_IOS_CLIENT'];
exports.onExecutePostLogin=async(event,api)=>{
  if(!CLIENTS.includes(event.client?.client_id)||event.resource_server?.identifier!==AUDIENCE
    ||event.connection?.strategy!=='google-oauth2'||event.transaction?.protocol!=='oidc-basic-profile')return;
  const methods=event.authentication?.methods;
  if(!Array.isArray(methods)||!methods.length)return;
  const primary=methods.filter(m=>m?.name==='federated');
  if(!primary.length)return;
  const times=primary.map(m=>typeof m.timestamp==='string'?Date.parse(m.timestamp):NaN);
  if(times.some(v=>!Number.isFinite(v)||v<0||v>Date.now()))return;
  // Oldest federation authentication is conservative; a newer token/method cannot
  // turn an old authentication into a fresh one. Never use Date.now() as proof.
  api.accessToken.setCustomClaim(CLAIM,Math.floor(Math.min(...times)/1000));
};
