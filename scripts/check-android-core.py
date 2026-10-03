"""Run the same synthetic pairing cases against native Java without Android SDK."""
import argparse
import base64
import json
from pathlib import Path
import subprocess


def certificate_cases():
    """Ephemeral synthetic certs; private key stays in memory, never in the ZIP."""
    from datetime import datetime, timedelta, timezone
    import ipaddress
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    host = '192.168.10.20'
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)])

    def cert(sans, start=-1, end=1):
        builder = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                   .serial_number(x509.random_serial_number()).not_valid_before(now + timedelta(days=start))
                   .not_valid_after(now + timedelta(days=end)))
        if sans is not None:
            builder = builder.add_extension(x509.SubjectAlternativeName(sans), False)
        return builder.sign(key, hashes.SHA256())

    ip = x509.IPAddress(ipaddress.ip_address(host))
    good = cert([ip])
    cases = [
        (True, 'valid-ip-pin', good, host, None, 1),
        (True, 'multi-interface', cert([x509.IPAddress(ipaddress.ip_address('10.0.0.4')), ip]), host, None, 1),
        (False, 'wrong-pin', good, host, '0' * 64, 1),
        (False, 'wrong-ip-san', cert([x509.IPAddress(ipaddress.ip_address('192.168.10.21'))]), host, None, 1),
        (False, 'dns-san-is-not-ip', cert([x509.DNSName(host)]), host, None, 1),
        (False, 'cn-only-is-not-ip', cert(None), host, None, 1),
        (False, 'expired', cert([ip], -3, -2), host, None, 1),
        (False, 'not-yet-valid', cert([ip], 2, 3), host, None, 1),
        (False, 'ipv6-is-not-ipv4', cert([x509.IPAddress(ipaddress.ip_address('2001:db8::1'))]), host, None, 1),
        (False, 'unrelated-dns-and-ip', cert([x509.DNSName(host), x509.IPAddress(ipaddress.ip_address('10.0.0.4'))]), host, None, 1),
        (False, 'two-leaves', good, host, None, 2),
        (False, 'empty-chain', good, host, None, 0),
        (False, 'null-chain', good, host, None, -1),
        (False, 'public-host', good, '8.8.8.8', None, 1),
        (False, 'noncanonical-host', good, '192.168.010.20', None, 1),
        (False, 'short-pin', good, host, 'ab', 1),
    ]
    return ''.join('\t'.join([str(valid).lower(), label, address, pin or certificate.fingerprint(hashes.SHA256()).hex(),
                              str(chain_size), base64.b64encode(certificate.public_bytes(serialization.Encoding.DER)).decode()]) + '\n'
                   for valid, label, certificate, address, pin, chain_size in cases)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--java', default='java')
    p.add_argument('--javac', default='javac')
    args = p.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = root / '.local/java-checks'
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run([args.javac, '-encoding', 'UTF-8', '-d', str(output),
        str(root / 'android/app/src/main/java/com/jiezheshuizz/niohcompanion/LocalSyncPairing.java'),
        str(root / 'android/app/src/main/java/com/jiezheshuizz/niohcompanion/LocalSyncTrust.java'),
        str(root / 'scripts/android-tests/PairingChecks.java'),
        str(root / 'scripts/android-tests/TrustChecks.java')], check=True)
    cases = json.loads((root / 'scripts/ios-tests/pairing-cases.json').read_text(encoding='utf-8'))
    lines = ''.join(str(row['valid']).lower() + '\t' + base64.b64encode(row['qr'].encode()).decode() + '\n' for row in cases)
    subprocess.run([args.java, '-cp', str(output), 'com.jiezheshuizz.niohcompanion.PairingChecks'],
                   input=lines, text=True, check=True)
    subprocess.run([args.java, '-cp', str(output), 'com.jiezheshuizz.niohcompanion.TrustChecks'],
                   input=certificate_cases(), text=True, check=True)

if __name__ == '__main__':
    main()
