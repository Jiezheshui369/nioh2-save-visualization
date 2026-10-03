package com.jiezheshuizz.niohcompanion;

import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Collection;
import java.util.List;

/** Request-scoped trust for the one LAN leaf certificate pinned in a QR code. */
final class LocalSyncTrust {
    private LocalSyncTrust() {}

    static void verify(X509Certificate[] chain, String host, String pin) throws CertificateException {
        try {
            if (!LocalSyncPairing.isPrivateIp(host) || pin == null || !pin.matches("[a-f0-9]{64}")
                    || chain == null || chain.length != 1 || chain[0] == null)
                throw new CertificateException("电脑证书格式无效。");
            X509Certificate cert = chain[0];
            if (!MessageDigest.isEqual(pin.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                    fingerprint(cert).getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
                throw new CertificateException("电脑证书与二维码不匹配。");
            cert.checkValidity();
            // An IP in CN or a DNS SAN is NOT an IP identity. Never resolve DNS here.
            Collection<List<?>> names = cert.getSubjectAlternativeNames();
            if (names != null) {
                for (List<?> name : names) {
                    if (name.size() == 2 && Integer.valueOf(7).equals(name.get(0)) && host.equals(name.get(1))) return;
                }
            }
            throw new CertificateException("电脑证书的 IP 地址与二维码不匹配。");
        } catch (CertificateException e) {
            throw e;
        } catch (Exception e) {
            throw new CertificateException("电脑身份验证失败，请重新配对。", e);
        }
    }

    static String fingerprint(X509Certificate cert) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
        final char[] hex = "0123456789abcdef".toCharArray();
        StringBuilder out = new StringBuilder(64);
        for (byte value : digest) out.append(hex[(value & 255) >>> 4]).append(hex[value & 15]);
        return out.toString();
    }
}
