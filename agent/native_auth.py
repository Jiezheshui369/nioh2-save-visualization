"""Native-only OAuth code/PKCE. Never returns credentials across the UI boundary.

Tokens live only in this process; closing/logging out drops them. No refresh token
is requested. Network I/O begins only after an explicit start_login call.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler

ISSUER = 'https://review-login.invalid/'
CLIENT_ID = 'REVIEW_ONLY_NOT_CONFIGURED'
AUDIENCE = 'https://review-relay.invalid'
CALLBACK = 'http://127.0.0.1:13255/oauth/callback'
LOGOUT_CALLBACK = 'http://127.0.0.1:13255/oauth/logout/callback'
PORT = 13255
FRESH_AUTH_CLAIM = AUDIENCE + '/claims/authenticated_at'


def authentication_diagnostics(tokens, now=None):
    """Only call for the exact tokens already verified by native JOSE policy.
    No identity, timestamp or credential is serialized across the bridge.
    """
    now = time.time() if now is None else now
    def claims(name):
        return json.loads(base64.urlsafe_b64decode(tokens[name].split('.')[1] + '==='))
    identity, access = claims('id_token'), claims('access_token')
    def valid(value): return type(value) is int and 0 <= value <= now
    value = access.get(FRESH_AUTH_CLAIM)
    return {'idAuthenticationRecent': valid(identity.get('auth_time')) and now - identity['auth_time'] <= 300,
            'serviceAuthenticationEvidence': valid(value),
            'serviceAuthenticationRecent': valid(value) and now - value <= 300}


class AuthFailure(Exception):
    """Internal fixed-code failure, never an upstream message."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AuthFailure('NETWORK_ERROR')


def request_json(url, payload=None):
    # Fixed issuer URLs only; reject redirects, proxies and unbounded responses.
    if url not in (ISSUER + 'oauth/token', ISSUER + '.well-known/jwks.json'):
        raise AuthFailure('NETWORK_ERROR')
    data = None if payload is None else urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(url, data=data, headers={'Accept': 'application/json'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=15) as response:
        raw = response.read(256 * 1024 + 1)
        if len(raw) > 256 * 1024:
            raise AuthFailure('INVALID_RESPONSE')
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise AuthFailure('INVALID_RESPONSE')
        return value


def verify_tokens(tokens, nonce):
    # Mature JOSE implementation; no hand-written signature verification.
    from authlib.jose import JsonWebToken
    jwt = JsonWebToken(['RS256'])
    keys = request_json(ISSUER + '.well-known/jwks.json')
    if not isinstance(keys.get('keys'), list) or len(keys['keys']) > 20:
        raise AuthFailure('INVALID_TOKEN')
    def decode(raw, audience):
        if not isinstance(raw, str) or len(raw) > 32768:
            raise AuthFailure('INVALID_TOKEN')
        try:
            header = json.loads(base64.urlsafe_b64decode(raw.split('.')[0] + '==='))
        except Exception:
            raise AuthFailure('INVALID_TOKEN') from None
        if not isinstance(header, dict) or header.get('alg') != 'RS256' or any(k in header for k in ('crit', 'jku', 'x5u', 'jwk')):
            raise AuthFailure('INVALID_TOKEN')
        claims = jwt.decode(raw, keys, claims_options={
            'iss': {'essential': True, 'value': ISSUER},
            'aud': {'essential': True, 'value': audience},
            'exp': {'essential': True}, 'iat': {'essential': True},
            'sub': {'essential': True},
        })
        claims.validate(leeway=0)
        now = time.time()
        for field in ('exp', 'iat', 'nbf'):
            value = claims.get(field)
            if field == 'nbf' and value is None:
                continue
            if type(value) is not int or not 0 <= value <= 9007199254740991:
                raise AuthFailure('INVALID_TOKEN')
        if claims['exp'] <= now or claims['iat'] > now or claims.get('nbf', 0) > now:
            raise AuthFailure('INVALID_TOKEN')
        if not isinstance(claims['sub'], str) or not claims['sub']:
            raise AuthFailure('INVALID_TOKEN')
        audience_value = claims.get('aud')
        if not (isinstance(audience_value, str) or isinstance(audience_value, list)
                and audience_value and all(isinstance(value, str) for value in audience_value)):
            raise AuthFailure('INVALID_TOKEN')
        return claims
    identity = decode(tokens.get('id_token'), CLIENT_ID)
    access = decode(tokens.get('access_token'), AUDIENCE)
    authenticated = identity.get('auth_time')
    if type(authenticated) is not int or not 0 <= time.time() - authenticated <= 300:
        raise AuthFailure('FRESH_AUTH_REQUIRED')
    if not isinstance(identity.get('nonce'), str) or not secrets.compare_digest(identity['nonce'], nonce):
        raise AuthFailure('INVALID_TOKEN')
    aud = identity['aud']
    if (isinstance(aud, list) and len(aud) > 1 or 'azp' in identity) and identity.get('azp') != CLIENT_ID:
        raise AuthFailure('INVALID_TOKEN')
    if access['sub'] != identity['sub'] or access.get('azp', access.get('client_id')) != CLIENT_ID:
        raise AuthFailure('INVALID_TOKEN')
    if 'azp' in access and 'client_id' in access and access['azp'] != access['client_id']:
        raise AuthFailure('INVALID_TOKEN')
    if not isinstance(access.get('scope'), str) or 'relay:connect' not in access['scope'].split():
        raise AuthFailure('MISSING_SCOPE')
    if tokens.get('token_type', '').lower() != 'bearer':
        raise AuthFailure('INVALID_TOKEN')
    at_hash = identity.get('at_hash')
    if at_hash is not None:
        expected = base64.urlsafe_b64encode(hashlib.sha256(tokens['access_token'].encode('ascii')).digest()[:16]).rstrip(b'=').decode()
        if not isinstance(at_hash, str) or not secrets.compare_digest(at_hash, expected):
            raise AuthFailure('INVALID_TOKEN')
    return min(identity['exp'], access['exp'])


class NativeAuth:
    def _capture_remote_identity(self):
        """Native dependency only. Verified tokens remain inside this process."""
        from agent.mvp_remote import NativeIdentity
        with self._lock:
            if self._state != 'signed-in' or self._tokens is None or time.time() >= self._expires:
                return None
            try:
                # These exact tokens entered _tokens only after self._verify
                # validated signature, issuer, audience, subject and expiry.
                claims = json.loads(base64.urlsafe_b64decode(self._tokens['id_token'].split('.')[1] + '==='))
                if claims.get('iss') != ISSUER or not isinstance(claims.get('sub'), str) or not claims['sub']:
                    return None
                return NativeIdentity(ISSUER, claims['sub'], int(self._expires * 1000), self._tokens['access_token'])
            except Exception:
                return None

    def configure_remote_mvp(self, *, device, store, enabled=False, **ports):
        """Native startup injection only; deliberately absent from HTTP actions.

        Does not provision keys or register devices. Approved key-store/startup
        code must call this explicitly; the default application never calls it.
        """
        from agent.mvp_remote_factory import create_pc_runtime
        runtime = create_pc_runtime(identity=self._capture_remote_identity, device=device,
                                    store=store, enabled=enabled, **ports)
        with self._lock:
            old = self._remote
            detached = old.take_invalidations()
            self._remote = runtime
        old.cancel_detached(detached)

    def remote_action(self, action, value=None):
        # Native runtime owns identity and keys; never return credentials here.
        if action == 'status' and self._remote_startup is not None and self._remote_startup.reason:
            return {'state': 'unconfigured', 'enabled': False, 'reason': self._remote_startup.reason, 'pending': []}
        return self._remote.mvp_action(action, value)

    def __init__(self, *, opener=webbrowser.open, exchange=request_json, verifier=verify_tokens, timeout=180, remote_runtime=None, remote_startup=None):
        from agent.remote_runtime import NativeRemoteRuntime
        self._remote = remote_runtime if remote_runtime is not None else NativeRemoteRuntime()
        self._remote_startup = remote_startup
        self._expiry_timer = None
        self._lock = threading.RLock()
        self._opener, self._exchange, self._verify = opener, exchange, verifier
        self._timeout = timeout
        self._generation = 0
        # Local cache session salt, never an OAuth credential or UI authorization token.
        self._local_data_nonce = secrets.token_bytes(32)
        self._server = None
        self._tokens = None
        self._expires = 0
        self._state = 'signed-out'
        self._error = None

    def _local_data_context_locked(self):
        if self._state != 'signed-in' or not self._tokens or time.time() >= self._expires:
            return None
        try:
            # _tokens is populated only after the production verifier accepts the tokens.
            claims = json.loads(base64.urlsafe_b64decode(self._tokens['id_token'].split('.')[1] + '==='))
            subject = claims.get('sub')
            if claims.get('iss') != ISSUER or not isinstance(subject, str) or not subject or len(subject) > 4096:
                return None
            scope = hashlib.sha256(('save-asset-local-data-v1\0' + ISSUER + '\0' + subject).encode('utf-8')).hexdigest()
            session = hashlib.sha256(self._local_data_nonce + str(self._generation).encode('ascii') + scope.encode('ascii')).hexdigest()
            return {'localDataScope': scope, 'localDataSessionId': session}
        except Exception:
            return None

    def local_data_context(self):
        # status() also invalidates expired credentials. Only opaque local identifiers cross.
        value = self.status()
        if value.get('state') != 'signed-in':
            return None
        if 'localDataScope' not in value or 'localDataSessionId' not in value:
            return None
        return {'localDataScope': value['localDataScope'], 'localDataSessionId': value['localDataSessionId']}

    def status(self):
        detached = ()
        with self._lock:
            if self._state == 'signed-in' and time.time() >= self._expires:
                self._tokens = None
                self._state = 'signed-out'
                detached = self._remote.take_invalidations()
            result = {'state': self._state}
            context = self._local_data_context_locked()
            if context is not None:
                result.update(context)
            if self._state == 'signed-in' and self._tokens:
                try: result.update(authentication_diagnostics(self._tokens))
                except Exception: pass  # Injection tests may use opaque fake tokens.
            if self._error:
                result['errorCode'] = 'AUTH_' + self._error
        self._remote.cancel_detached(detached)
        return result

    def _detach_remote_locked(self):
        if self._expiry_timer is not None:
            self._expiry_timer.cancel()
            self._expiry_timer = None
        return self._remote.take_invalidations()

    def _arm_expiry_locked(self, generation):
        def expire():
            with self._lock:
                if generation != self._generation:
                    return
            self.status()
        self._expiry_timer = threading.Timer(max(0.001, self._expires - time.time()), expire)
        self._expiry_timer.daemon = True
        self._expiry_timer.start()

    def cancel(self):
        with self._lock:
            self._generation += 1
            self._tokens = None
            self._state, self._error = 'signed-out', None
            detached = self._detach_remote_locked()
        self._remote.cancel_detached(detached)
        return self.status()

    def logout(self):
        with self._lock:
            # Invalidation and ownership capture must be one transaction. A login
            # cannot acquire the cancelled generation between these operations.
            self._generation += 1
            self._tokens = None
            self._expires = 0
            generation = self._generation
            self._state, self._error = 'signing-in', None
            detached = self._detach_remote_locked()
        self._remote.cancel_detached(detached)
        threading.Thread(target=self._run, args=(generation, True), daemon=True,
                         name='save-asset-native-logout').start()
        return self.status()

    def start_login(self):
        dependency_missing = False
        with self._lock:
            if self._state == 'signing-in':
                return self.status()
            try:
                import authlib.jose  # Fail before opening a browser if missing.
            except ImportError:
                self._tokens = None
                self._state, self._error = 'error', 'DEPENDENCY_UNAVAILABLE'
                dependency_missing = True
            if not dependency_missing:
                self._generation += 1
                generation = self._generation
                self._tokens = None
                self._state, self._error = 'signing-in', None
            detached = self._detach_remote_locked()
        self._remote.cancel_detached(detached)
        if dependency_missing:
            return self.status()
        threading.Thread(target=self._run, args=(generation,), daemon=True, name='save-asset-native-auth').start()
        return self.status()

    def _run(self, generation, logout=False):
        state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        completed = []
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass  # OAuth query must never be logged.
            def do_GET(self):
                try:
                    code = owner._callback(self.path, self.headers.get_all('Host', []), state, logout)
                except (AuthFailure, ValueError, TypeError):
                    self.send_error(400, 'Invalid authentication callback')
                    return
                if completed:
                    self.send_error(409, 'Callback already consumed')
                    return
                completed.append(code)
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Referrer-Policy', 'no-referrer')
                self.send_header('Content-Security-Policy', "default-src 'none'")
                self.end_headers()
                self.wfile.write(b'Return to Save Asset. Authentication is being checked.')
        class CallbackServer(HTTPServer):
            allow_reuse_address = False
            def handle_error(self, request, client_address):
                pass  # No callback request or exception data may reach logs.
            def get_request(self):
                sock, address = super().get_request()
                sock.settimeout(2)
                return sock, address
        server = None
        try:
            # Wait only for our previous cancelled listener to finish, never take over a port.
            with self._lock:
                previous = self._server
            for _ in range(20):
                with self._lock:
                    if generation != self._generation:
                        return
                    if self._server is not previous or previous is None:
                        break
                time.sleep(0.05)
            server = CallbackServer(('127.0.0.1', PORT), Handler)
            server.timeout = 0.25
            with self._lock:
                if generation != self._generation:
                    return
                self._server = server
            params = dict(response_type='code', client_id=CLIENT_ID, redirect_uri=CALLBACK,
                          audience=AUDIENCE, scope='openid relay:connect', state=state, nonce=nonce,
                          code_challenge=challenge, code_challenge_method='S256', max_age='0', prompt='login')
            endpoint = 'authorize'
            if logout:
                endpoint = 'oidc/logout'
                params = dict(client_id=CLIENT_ID, post_logout_redirect_uri=LOGOUT_CALLBACK, state=state)
            with self._lock:
                if generation != self._generation:
                    return
                if not self._opener(ISSUER + endpoint + '?' + urllib.parse.urlencode(params)):
                    raise AuthFailure('BROWSER_UNAVAILABLE')
            deadline = time.monotonic() + self._timeout
            while not completed:
                with self._lock:
                    if generation != self._generation:
                        return
                if time.monotonic() >= deadline:
                    raise AuthFailure('LOGIN_TIMEOUT')
                server.handle_request()
            server.server_close()
            with self._lock:
                if self._server is server:
                    self._server = None
                if generation != self._generation:
                    return
            if completed[0] is None:
                raise AuthFailure('LOGIN_CANCELLED')
            if logout:
                with self._lock:
                    if generation == self._generation:
                        self._state, self._error = 'signed-out', None
                return
            tokens = self._exchange(ISSUER + 'oauth/token', dict(grant_type='authorization_code',
                client_id=CLIENT_ID, redirect_uri=CALLBACK, code=completed[0], code_verifier=verifier))
            expires = self._verify(tokens, nonce)
            with self._lock:
                if generation == self._generation:
                    self._tokens = {'access_token': tokens['access_token'], 'id_token': tokens['id_token']}
                    self._expires = expires
                    self._state, self._error = 'signed-in', None
                    self._arm_expiry_locked(generation)
            if self._remote_startup is not None:
                self._remote_startup.activate(self)
        except Exception as exc:
            with self._lock:
                if generation == self._generation:
                    known = {'LOGIN_CANCELLED', 'LOGIN_TIMEOUT', 'BROWSER_UNAVAILABLE', 'INVALID_TOKEN', 'MISSING_SCOPE', 'FRESH_AUTH_REQUIRED'}
                    self._state = 'error'
                    self._error = str(exc) if isinstance(exc, AuthFailure) and str(exc) in known else 'LOGIN_FAILED'
                    self._tokens = None
        finally:
            if server:
                server.server_close()
            with self._lock:
                if self._server is server:
                    self._server = None

    @staticmethod
    def _callback(target, hosts, expected_state, logout=False):
        parsed = urllib.parse.urlsplit(target)
        path = '/oauth/logout/callback' if logout else '/oauth/callback'
        if hosts != ['127.0.0.1:13255'] or parsed.scheme or parsed.netloc or parsed.path != path or parsed.fragment or len(target) > 8192:
            raise AuthFailure('INVALID_CALLBACK')
        try:
            pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True, max_num_fields=8)
        except ValueError:
            raise AuthFailure('INVALID_CALLBACK') from None
        values = dict(pairs)
        if len(values) != len(pairs) or not values.get('state', '').isascii() or not secrets.compare_digest(values.get('state', ''), expected_state):
            raise AuthFailure('INVALID_STATE')
        if 'iss' in values and values['iss'] != ISSUER:
            raise AuthFailure('INVALID_CALLBACK')
        if 'error' in values and 'code' not in values:
            return None
        if logout and 'code' not in values:
            return 'logout'
        if not values.get('code') or 'error' in values or len(values['code']) > 4096:
            raise AuthFailure('INVALID_CALLBACK')
        return values['code']
