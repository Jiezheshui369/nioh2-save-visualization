package com.jiezheshuizz.niohcompanion;

import android.content.Intent;
import android.content.SharedPreferences;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.journeyapps.barcodescanner.ScanOptions;
import com.journeyapps.barcodescanner.ScanIntentResult;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

@CapacitorPlugin(name = "LocalSync")
public class LocalSyncPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs() { return getContext().getSharedPreferences("nioh-local-sync", 0); }

    @PluginMethod public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("paired", prefs().contains("token"));
        out.put("host", prefs().getString("host", ""));
        call.resolve(out);
    }

    @PluginMethod public void forget(PluginCall call) {
        worker.execute(() -> {
            if (prefs().edit().clear().commit()) call.resolve();
            else call.reject("清除配对失败，请重试。");
        });
    }

    @PluginMethod public void scan(PluginCall call) {
        ScanOptions options = new ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("扫描电脑“同步到手机”页面的二维码").setBeepEnabled(false).setOrientationLocked(false);
        Intent intent = options.createScanIntent(getContext());
        startActivityForResult(call, intent, "scanResult");
    }

    @ActivityCallback private void scanResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ScanIntentResult scan = ScanIntentResult.parseActivityResult(result.getResultCode(), result.getData());
        JSObject out = new JSObject();
        out.put("value", scan.getContents() == null ? "" : scan.getContents());
        call.resolve(out);
    }

    @PluginMethod public void receive(PluginCall call) {
        String qr = call.getString("qr", "");
        worker.execute(() -> {
            HttpsURLConnection conn = null;
            try {
                boolean pairing = !qr.isEmpty();
                Map<String,String> c = new HashMap<>();
                if (pairing) {
                    c = LocalSyncPairing.parse(qr);
                } else {
                    for (String k : new String[]{"host", "port", "pin", "token"}) c.put(k, prefs().getString(k, ""));
                }
                String host = c.getOrDefault("host", "");
                LocalSyncPairing.validate(c);
                int port = Integer.parseInt(c.get("port"));
                final String pin = c.get("pin");
                X509TrustManager trust = new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    public void checkClientTrusted(X509Certificate[] chain, String type) throws CertificateException { throw new CertificateException(); }
                    public void checkServerTrusted(X509Certificate[] chain, String type) throws CertificateException {
                        LocalSyncTrust.verify(chain, host, pin);
                    }
                };
                SSLContext tls = SSLContext.getInstance("TLS");
                tls.init(null, new TrustManager[]{trust}, null);
                conn = (HttpsURLConnection) new URL("https://" + host + ":" + port + (pairing ? "/v1/pair" : "/v1/pull")).openConnection();
                conn.setSSLSocketFactory(tls.getSocketFactory());
                // Trust is scoped to this request's literal LAN IP and exact QR-pinned certificate.
                conn.setHostnameVerifier((hostname, session) -> {
                    try {
                        if (!host.equals(hostname)) return false;
                        java.security.cert.Certificate[] peer = session.getPeerCertificates();
                        if (peer.length != 1 || !(peer[0] instanceof X509Certificate)) return false;
                        LocalSyncTrust.verify(new X509Certificate[]{(X509Certificate) peer[0]}, host, pin);
                        return true;
                    }
                    catch (Exception e) { return false; }
                });
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(8000); conn.setReadTimeout(15000);
                conn.setRequestMethod("POST"); conn.setDoOutput(true); conn.setFixedLengthStreamingMode(0);
                conn.setRequestProperty("Authorization", "Bearer " + c.get("token"));
                conn.getOutputStream().close();
                int status = conn.getResponseCode();
                if (status != 200) throw new Exception(status == 401 ? "配对已过期或失效，请在电脑重新生成二维码。" : "电脑未能提供档案，请检查同步页面。");
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                try (InputStream stream = conn.getInputStream()) {
                    byte[] chunk = new byte[8192]; int count;
                    while ((count = stream.read(chunk)) != -1) {
                        if (buffer.size() + count > 26 * 1024 * 1024) throw new Exception("档案过大，已停止同步。");
                        buffer.write(chunk, 0, count);
                    }
                }
                JSObject response = new JSObject(buffer.toString(StandardCharsets.UTF_8.name()));
                org.json.JSONObject archive = response.optJSONObject("archive");
                if (!response.optString("revision", "").matches("[a-f0-9]{64}") || archive == null
                    || !"nioh2-character-assets".equals(archive.optString("format"))
                    || !"1.0.0".equals(archive.optString("version"))
                    || archive.optJSONObject("character") == null || archive.optJSONArray("builds") == null)
                    throw new Exception("电脑返回的档案无效，旧档案仍保留。");
                if (pairing) {
                    String device = response.getString("deviceToken");
                    if (device == null || !device.matches("[A-Za-z0-9_-]{43}")) throw new Exception("电脑未返回有效配对凭据。");
                    SharedPreferences.Editor edit = prefs().edit();
                    for (String k : new String[]{"host", "port", "pin"}) edit.putString(k, c.get(k));
                    if (!edit.putString("token", device).commit()) throw new Exception("手机无法保存配对，请检查存储空间。");
                }
                response.remove("deviceToken");
                call.resolve(response);
            } catch (Exception e) {
                call.reject(e.getMessage() != null && (e.getMessage().contains("配对") || e.getMessage().contains("档案") || e.getMessage().contains("电脑"))
                    ? e.getMessage() : "连接失败。请确认同一 Wi-Fi、电脑同步已开启，且专用网络防火墙允许连接。旧档案仍保留。");
            } finally { if (conn != null) conn.disconnect(); }
        });
    }

    static boolean isPrivateIp(String value) {
        return LocalSyncPairing.isPrivateIp(value);
    }
    @Override protected void handleOnDestroy() { worker.shutdownNow(); }
}
