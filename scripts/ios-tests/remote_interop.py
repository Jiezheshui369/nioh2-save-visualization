"""Pipe-only interoperability peer. Synthetic keys never leave process memory."""
import sys, json, base64
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from agent.remote_hpke import encrypt_signed, decrypt_signed

def b64(value): return base64.urlsafe_b64encode(value).decode().rstrip('=')
def decode(value): return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
def point(key): return key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
def public(raw): return ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decode(raw))
try:
    agreement, signing = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    print(json.dumps({'agreement':b64(point(agreement)), 'signing':b64(point(signing))}), flush=True)
    request = json.loads(sys.stdin.readline())
    context = b'synthetic-cross-platform-context'
    plain = decrypt_signed(decode(request['wire']), agreement, public(request['signing']), 'swift-synthetic', context)
    if plain != b'synthetic-ios-to-windows': raise ValueError('INTEROP_FAILED')
    wire = encrypt_signed(b'synthetic-windows-to-ios', public(request['agreement']), signing, 'python-synthetic', context)
    print(json.dumps({'wire':b64(wire)}), flush=True)
except Exception:
    print('Synthetic interoperability failed', file=sys.stderr)
    sys.exit(1)
