/** QR text is untrusted input, even before the native TLS layer validates it again. */
export interface PairingEndpoint { host: string; port: number; pin: string; token: string }
export function parsePairingQr(qr: string): PairingEndpoint {
  const invalid = () => new Error("配对信息无效，请重新扫描电脑二维码。");
  const prefix = "niohcompanion://pair#";
  if (qr.length > 2048 || !qr.startsWith(prefix)) throw invalid();
  const fields = new Map<string, string>();
  for (const part of qr.slice(prefix.length).split("&")) {
    const at = part.indexOf("=");
    if (at < 1) throw invalid();
    let key: string, value: string;
    try { key = decodeURIComponent(part.slice(0, at)); value = decodeURIComponent(part.slice(at + 1)); }
    catch { throw invalid(); }
    if (fields.has(key) || !["host", "port", "pin", "token"].includes(key)) throw invalid();
    fields.set(key, value);
  }
  if (fields.size !== 4) throw invalid();
  const host = fields.get("host")!, portText = fields.get("port")!, pin = fields.get("pin")!, token = fields.get("token")!;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) throw invalid();
  const [a, b] = parts.map(Number);
  if (!(a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168)) throw invalid();
  const port = Number(portText);
  if (!/^[1-9][0-9]{3,4}$/.test(portText) || String(port) !== portText || port < 1024 || port > 65535
    || pin.length !== 64 || !/^[a-f0-9]{64}$/.test(pin) || token.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
  return { host, port, pin, token };
}
