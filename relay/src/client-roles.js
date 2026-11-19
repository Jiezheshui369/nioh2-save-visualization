import {authConfig,deviceId,fail} from './auth.js';
/** Explicit public native-client roles. Legacy one-app deployments remain valid. */
export function clientRoles(env) {
  const {clients}=authConfig(env,false),pc=env.AUTH0_PC_CLIENT_ID;
  const value=env.AUTH0_APP_CLIENT_IDS ?? env.AUTH0_APP_CLIENT_ID;
  const apps=typeof value==='string'?value.split(',').map(id=>id.trim()):[];
  if(!deviceId(pc)||!apps.length||apps.length>15||apps.some(id=>!deviceId(id)||id===pc)
    ||new Set(apps).size!==apps.length||![pc,...apps].every(id=>clients.includes(id)))fail('NOT_CONFIGURED',503);
  return Object.fromEntries([[pc,'pc'],...apps.map(id=>[id,'app'])]);
}
export function clientRole(identity,env) {
  const roles=clientRoles(env),role=Object.hasOwn(roles,identity.clientId)?roles[identity.clientId]:null;
  if(!role)fail('UNAUTHORIZED');return role;
}
