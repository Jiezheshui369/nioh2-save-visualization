"""Native-only protocol candidate: RFC9180 base HPKE plus RFC7515 ES256 JWS.

Pure, one-shot adapters: no network, enrollment, filesystem or key generation.
Key authorization/context/replay/lifecycle policy remains the native caller's job.
Not enabled by the installed app; Android interoperability is a separate gate.
"""
import re
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.hpke import AEAD, KDF, KEM, Suite
from authlib.jose import JsonWebSignature

SUITE = Suite(KEM.P256, KDF.HKDF_SHA256, AEAD.AES_128_GCM)
MAX_PLAINTEXT = 4 * 1024 * 1024
MAX_WIRE = 6 * 1024 * 1024
TYPE = 'save-asset-hpke-jws-v1'
DOMAIN = b'SaveAsset-native/HPKE-P256-HKDFSHA256-AES128GCM+JWS-ES256/v1\x00'


class RemoteCryptoError(Exception):
    pass


def _key(key):
    if not isinstance(key, (ec.EllipticCurvePrivateKey, ec.EllipticCurvePublicKey)) or not isinstance(key.curve, ec.SECP256R1):
        raise RemoteCryptoError('INVALID_KEY')


def _info(context, key_id):
    if not isinstance(context, bytes) or not 1 <= len(context) <= 4096 or not isinstance(key_id, str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', key_id):
        raise RemoteCryptoError('INVALID_CONTEXT')
    return DOMAIN + len(key_id).to_bytes(2, 'big') + key_id.encode('ascii') + context


def encrypt_signed(plaintext, recipient, signer, key_id, context):
    """context MUST bind account, both devices/versions, direction and request ID."""
    _key(recipient)
    _key(signer)
    if not isinstance(recipient, ec.EllipticCurvePublicKey) or not isinstance(signer, ec.EllipticCurvePrivateKey):
        raise RemoteCryptoError('INVALID_KEY')
    info = _info(context, key_id)
    if not isinstance(plaintext, bytes) or not 1 <= len(plaintext) <= MAX_PLAINTEXT:
        raise RemoteCryptoError('CAPACITY')
    encrypted = SUITE.encrypt(plaintext, recipient, info=info)
    # PEM exists in native memory only; no key is written or sent to a WebView.
    private = signer.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    wire = JsonWebSignature(['ES256']).serialize_compact({'alg':'ES256','kid':key_id,'typ':TYPE}, encrypted, private)
    if len(wire) > MAX_WIRE:
        raise RemoteCryptoError('CAPACITY')
    return wire


def decrypt_signed(wire, recipient, sender, expected_key_id, context):
    _key(recipient)
    _key(sender)
    info = _info(context, expected_key_id)
    if not isinstance(recipient, ec.EllipticCurvePrivateKey) or not isinstance(sender, ec.EllipticCurvePublicKey):
        raise RemoteCryptoError('INVALID_KEY')
    if not isinstance(wire, bytes) or not 1 <= len(wire) <= MAX_WIRE:
        raise RemoteCryptoError('CAPACITY')
    try:
        public = sender.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        verified = JsonWebSignature(['ES256']).deserialize_compact(wire, public)
        header = verified['header']
        if set(header) != {'alg','kid','typ'} or header != {'alg':'ES256','kid':expected_key_id,'typ':TYPE}:
            raise ValueError('Unexpected protected header')
        plaintext = SUITE.decrypt(verified['payload'], recipient, info=info)
        if not 1 <= len(plaintext) <= MAX_PLAINTEXT:
            raise ValueError('Unexpected plaintext size')
        return plaintext
    except Exception:
        raise RemoteCryptoError('AUTHENTICATION_FAILED') from None
