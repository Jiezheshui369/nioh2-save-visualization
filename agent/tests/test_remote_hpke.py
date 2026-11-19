"""Real standard-library cryptography, ephemeral synthetic keys in RAM only."""
import unittest
from cryptography.hazmat.primitives.asymmetric import ec
from agent.remote_hpke import decrypt_signed, encrypt_signed, RemoteCryptoError


class NativeHpkeTests(unittest.TestCase):
    def setUp(self):
        self.pc=ec.generate_private_key(ec.SECP256R1())
        self.phone=ec.generate_private_key(ec.SECP256R1())
        self.signer=ec.generate_private_key(ec.SECP256R1())
        self.context=b'["issuer.example","synthetic-subject","pc-1",1,"app-1",1,"read-1","pc-to-app"]'

    def wire(self, plaintext=b'synthetic-publication'):
        return encrypt_signed(plaintext,self.phone.public_key(),self.signer,'signing-1',self.context)

    def test_standard_hpke_and_jws_round_trip(self):
        wire=self.wire()
        self.assertEqual(wire.count(b'.'),2)
        self.assertNotIn(b'synthetic-publication',wire)
        self.assertEqual(decrypt_signed(wire,self.phone,self.signer.public_key(),'signing-1',self.context),b'synthetic-publication')

    def test_fresh_encapsulation_for_each_message(self):
        self.assertNotEqual(self.wire(),self.wire())

    def test_wrong_account_request_and_direction_context_rejected(self):
        wire=self.wire()
        for old,new in [(b'synthetic-subject',b'other-subject'),(b'read-1',b'read-2'),(b'pc-to-app',b'app-to-pc')]:
            with self.subTest(new=new),self.assertRaisesRegex(RemoteCryptoError,'AUTHENTICATION_FAILED'):
                decrypt_signed(wire,self.phone,self.signer.public_key(),'signing-1',self.context.replace(old,new))

    def test_wrong_recipient_and_sender_and_key_reference_rejected(self):
        wire=self.wire()
        for recipient,sender,kid in [(self.pc,self.signer.public_key(),'signing-1'),(self.phone,self.pc.public_key(),'signing-1'),(self.phone,self.signer.public_key(),'other-key')]:
            with self.assertRaisesRegex(RemoteCryptoError,'AUTHENTICATION_FAILED'):
                decrypt_signed(wire,recipient,sender,kid,self.context)

    def test_modified_payload_and_signature_rejected(self):
        for part in [1,2]:
            pieces=self.wire().split(b'.');data=bytearray(pieces[part]);data[3]=ord('A') if data[3]!=ord('A') else ord('B');pieces[part]=bytes(data)
            with self.assertRaisesRegex(RemoteCryptoError,'AUTHENTICATION_FAILED'):
                decrypt_signed(b'.'.join(pieces),self.phone,self.signer.public_key(),'signing-1',self.context)

    def test_non_p256_keys_and_empty_context_rejected(self):
        with self.assertRaisesRegex(RemoteCryptoError,'INVALID_KEY'):
            encrypt_signed(b'data',ec.generate_private_key(ec.SECP384R1()).public_key(),self.signer,'key',self.context)
        with self.assertRaisesRegex(RemoteCryptoError,'INVALID_CONTEXT'):
            encrypt_signed(b'data',self.phone.public_key(),self.signer,'key',b'')

    def test_wire_capacity_rejected_before_decode(self):
        with self.assertRaisesRegex(RemoteCryptoError,'CAPACITY'):
            decrypt_signed(b'',self.phone,self.signer.public_key(),'signing-1',self.context)


if __name__=='__main__':unittest.main()
