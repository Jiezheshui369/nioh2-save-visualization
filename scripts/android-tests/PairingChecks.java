package com.jiezheshuizz.niohcompanion;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class PairingChecks {
    public static void main(String[] args) throws Exception {
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line; int count = 0;
        while ((line = input.readLine()) != null) {
            String[] row = line.split("\\t", 2);
            boolean expected = row[0].equals("true");
            String qr = new String(Base64.getDecoder().decode(row[1]), StandardCharsets.UTF_8);
            boolean valid;
            try { LocalSyncPairing.parse(qr); valid = true; }
            catch (Exception e) { valid = false; }
            if (valid != expected) throw new AssertionError("Pairing case failed at index " + count);
            count++;
        }
        System.out.println(count + " JVM pairing cases passed; not an Android TLS/UI test.");
    }
}
