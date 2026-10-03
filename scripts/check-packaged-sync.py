"""Smoke-test the Windows EXE using synthetic data only; no game save is read.

Starts one hidden process with an isolated new data directory. Temporarily opens
its opt-in LAN TLS listener, validates pin/IP identity, then stops only that process.
Does not test WebView interaction or a physical phone.
"""
import argparse
import hashlib
import http.client
import json
from pathlib import Path
import socket
import ssl
import subprocess
import time
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]


def available_port():
    for port in range(14250, 14340):
        sockets = []
        try:
            for candidate in (port, port + 100):
                sock = socket.socket()
                sockets.append(sock)
                sock.bind(('127.0.0.1', candidate))
            return port
        except OSError:
            pass
        finally:
            for sock in sockets:
                sock.close()
    raise RuntimeError('No unused test port pair found')


def run(executable: Path, output: Path):
    executable = executable.resolve(strict=True)
    output = output.resolve()
    if not output.is_relative_to(ROOT / '.local'):
        raise ValueError('Test output must be a new directory under this project .local')
    output.mkdir(parents=True, exist_ok=False)
    empty_source = output / 'empty-source'
    empty_source.mkdir()
    fixture = json.loads((ROOT / 'public/data/demo-snapshot.json').read_text(encoding='utf-8'))
    fixture['safety']['originalMainSaveSha256'] = 'REDACTED'
    fixture['safety'].pop('snapshotCopySha256', None)
    fixture['privacy'] = {'redactedForSharing': True}
    # Ensure the additive effect-evidence contract survives the packaged TLS path.
    fixture['currentLoadout'][0].update({
        'effects': ['Ultimate Constitution'], 'effectsZh': ['体之深奥'],
        'effectIds': ['DAC2'], 'effectMagnitudes': [None],
        'effectValueDetails': [{'rawValue': 150, 'kind': 'condition', 'encoding': 'not-decoded'}],
    })
    archive = {'format': 'nioh2-character-assets', 'version': '1.0.0',
               'exportedAt': '2026-09-25T00:00:00Z', 'character': fixture, 'builds': []}
    port = available_port()

    def control(action, value=None):
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        try:
            connection.request('POST', '/api/mobile-sync/' + action, json.dumps(value or {}),
                               {'Content-Type': 'application/json', 'X-Nioh2-Desktop-Sync': '1'})
            response = connection.getresponse()
            data = json.loads(response.read())
            if response.status != 200:
                raise RuntimeError('Control request failed: ' + str(response.status))
            return data
        finally:
            connection.close()

    with (output / 'process.log').open('xb') as log:
        process = subprocess.Popen([str(executable), '--no-browser', '--port', str(port),
                                    '--data-dir', str(output / 'app-data'), '--source', str(empty_source)],
                                   cwd=str(executable.parent), stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        ready = False
        try:
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('Packaged process exited; see private process.log')
                try:
                    assert control('status')['enabled'] is False
                    ready = True
                    break
                except OSError:
                    time.sleep(0.2)
            if not ready:
                raise TimeoutError('Packaged process did not become ready')
            # Regression check the bundled intake, not only the Python source.
            for path, headers in (
                ('/api/import-save', [('Content-Length', '-1')]),
                ('/api/import-save', [('Content-Length', '1000000'), ('Content-Length', '1000000')]),
                ('/api/import-save', [('Content-Length', '1000000'), ('Transfer-Encoding', '')]),
                ('/api/refresh', [('Content-Length', '-1')]),
                ('/api/mobile-sync/stop', [('Content-Length', '0'), ('Content-Length', '0')]),
            ):
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
                try:
                    connection.putrequest('POST', path)
                    connection.putheader('X-Nioh2-Desktop-Sync', '1')
                    for name, value in headers:
                        connection.putheader(name, value)
                    connection.endheaders()
                    response = connection.getresponse()
                    assert response.status == 400, (path, response.status)
                    assert 'error' in json.loads(response.read())
                finally:
                    connection.close()
            status = control('publish', {'archive': archive, 'newInvite': True})
            assert status['publishedSnapshotId'] == fixture['snapshotId']
            assert status['publishedAt'] and status['lastSent'] is None
            fields = parse_qs(urlparse(status['urls'][0]).fragment)
            host, tls_port = fields['host'][0], int(fields['port'][0])
            cert = ssl.get_server_certificate((host, tls_port), timeout=8)
            assert hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert)).hexdigest() == fields['pin'][0]
            context = ssl.create_default_context(cadata=cert)  # Hostname/IP SAN checks stay enabled.

            def receive(path, token):
                conn = http.client.HTTPSConnection(host, tls_port, context=context, timeout=8)
                try:
                    conn.request('POST', '/v1/' + path, b'', {'Authorization': 'Bearer ' + token})
                    response = conn.getresponse()
                    return response.status, json.loads(response.read())
                finally:
                    conn.close()

            code, paired = receive('pair', fields['token'][0])
            assert code == 200 and paired['archive'] == archive
            assert receive('pair', fields['token'][0])[0] == 401
            code, pulled = receive('pull', paired['deviceToken'])
            assert code == 200 and pulled['revision'] == paired['revision']
            assert control('status')['lastSent']
            fixture['snapshotId'] = 'synthetic-second-publication'
            republished = control('publish', {'archive': archive})
            assert republished['publishedSnapshotId'] == fixture['snapshotId']
            assert republished['lastSent'] is None and republished['revision'] != paired['revision']
            code, updated = receive('pull', paired['deviceToken'])
            assert code == 200 and updated['archive']['character']['snapshotId'] == fixture['snapshotId']
            assert updated['revision'] == republished['revision']
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
            try:
                connection.request('POST', '/api/refresh', b'{}')
                response = connection.getresponse()
                assert response.status == 403
                response.read()
            finally:
                connection.close()
            assert receive('sources', paired['deviceToken'])[0] == 404
            control('stop')
            assert control('status')['enabled'] is False
            print('PASS: packaged EXE strict framing, refresh origin gate, publish/republish metadata, TLS pin + IP SAN, single-use pair, pull, route isolation, revoke')
        finally:
            if ready and process.poll() is None:
                try:
                    control('stop')
                except (OSError, RuntimeError):
                    pass
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    print('Owned process stopped; no original save accessed. Private test output retained at:', output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args()
    run(options.exe, options.output)
