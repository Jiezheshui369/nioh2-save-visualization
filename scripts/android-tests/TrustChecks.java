package com.jiezheshuizz.niohcompanion;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Base64;

public final class TrustChecks {
    public static void main(String[] args) throws Exception {
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        int count = 0;
        while ((line = input.readLine()) != null) {
            String[] row = line.split("\\t", -1);
            boolean expected = row[0].equals("true");
            X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(Base64.getDecoder().decode(row[5])));
            int length = Integer.parseInt(row[4]);
            X509Certificate[] chain = length < 0 ? null : new X509Certificate[length];
            if (chain != null) Arrays.fill(chain, cert);
            boolean valid;
            try { LocalSyncTrust.verify(chain, row[2], row[3]); valid = true; }
            catch (Exception e) { valid = false; }
            if (valid != expected) throw new AssertionError("Trust case failed: " + row[1]);
            count++;
        }
        System.out.println(count + " JVM DER certificate cases passed; not an Android network/device test.");
    }
}
