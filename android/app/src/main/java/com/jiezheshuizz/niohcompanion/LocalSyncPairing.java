package com.jiezheshuizz.niohcompanion;

import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;
import java.util.HashSet;
import java.util.Arrays;

/** Pure JVM validation; no Android APIs, DNS resolution or network requests. */
final class LocalSyncPairing {
    static Map<String, String> parse(String qr) throws Exception {
        String prefix = "niohcompanion://pair#";
        if (qr.length() > 2048 || !qr.startsWith(prefix)) throw invalid();
        Map<String, String> values = new HashMap<>();
        for (String field : qr.substring(prefix.length()).split("&", -1)) {
            String[] pair = field.split("=", 2);
            if (pair.length != 2) throw invalid();
            String key = URLDecoder.decode(pair[0], "UTF-8");
            String value = URLDecoder.decode(pair[1], "UTF-8");
            if (values.putIfAbsent(key, value) != null) throw invalid();
        }
        if (!values.keySet().equals(new HashSet<>(Arrays.asList("host", "port", "pin", "token")))) throw invalid();
        validate(values);
        return values;
    }
    static void validate(Map<String, String> values) throws Exception {
        if (!isPrivateIp(values.getOrDefault("host", ""))
            || !values.getOrDefault("port", "").matches("[1-9][0-9]{3,4}")
            || !values.getOrDefault("pin", "").matches("[a-f0-9]{64}")
            || !values.getOrDefault("token", "").matches("[A-Za-z0-9_-]{43}")) throw invalid();
        int port = Integer.parseInt(values.get("port"));
        if (port < 1024 || port > 65535) throw invalid();
    }
    static boolean isPrivateIp(String value) {
        if (!value.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] parts = value.split("\\.");
        int[] n = new int[4];
        for (int i = 0; i < 4; i++) {
            n[i] = Integer.parseInt(parts[i]);
            if (n[i] > 255 || !Integer.toString(n[i]).equals(parts[i])) return false;
        }
        return n[0] == 10 || (n[0] == 172 && n[1] >= 16 && n[1] <= 31) || (n[0] == 192 && n[1] == 168);
    }
    private static Exception invalid() { return new Exception("配对信息无效，请重新扫描电脑二维码。"); }
}
