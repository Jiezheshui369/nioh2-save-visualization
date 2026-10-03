import Foundation
import Security
import CryptoKit

// One ephemeral session per request. Never changes global TLS trust or logs credentials.
final class LocalSyncConnection: NSObject, URLSessionDataDelegate {
    private let endpoint: LocalSyncPairing
    private let pairing: Bool
    private let completion: (Result<[String: Any], Error>) -> Void
    private var session: URLSession?
    private var buffer = Data()
    private var finished = false
    private let maximum = 26 * 1024 * 1024

    init(endpoint: LocalSyncPairing, pairing: Bool,
         completion: @escaping (Result<[String: Any], Error>) -> Void) {
        self.endpoint = endpoint
        self.pairing = pairing
        self.completion = completion
        super.init()
    }
    private func error(_ message: String) -> Error {
        NSError(domain: "NiohLocalSync", code: 3, userInfo: [NSLocalizedDescriptionKey: message])
    }
    func start() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        configuration.tlsMinimumSupportedProtocolVersion = .TLSv12
        // A denied local-network permission must fail visibly, not hang forever.
        configuration.waitsForConnectivity = false
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
        self.session = session
        var request = URLRequest(url: endpoint.url(pairing: pairing))
        request.httpMethod = "POST"
        request.httpBody = Data()
        request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
        request.setValue("0", forHTTPHeaderField: "Content-Length")
        session.dataTask(with: request).resume()
    }
    private func finish(_ result: Result<[String: Any], Error>) {
        guard !finished else { return }
        finished = true
        session?.invalidateAndCancel()
        session = nil
        buffer.removeAll()
        DispatchQueue.main.async { self.completion(result) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(error("电脑返回了重定向，已拒绝发送配对凭据。")))
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              space.host == endpoint.host, space.port == endpoint.port,
              let trust = space.serverTrust, SecTrustGetCertificateCount(trust) == 1,
              let cert = SecTrustGetCertificateAtIndex(trust, 0) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        let digest = SHA256.hash(data: SecCertificateCopyData(cert) as Data)
            .map { String(format: "%02x", $0) }.joined()
        guard digest == endpoint.pin else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        // Exact pinned leaf is the sole trust anchor; SSL policy still validates the LAN IP.
        let policy = SecPolicyCreateSSL(true, endpoint.host as CFString)
        guard SecTrustSetPolicies(trust, policy) == errSecSuccess,
              SecTrustSetAnchorCertificates(trust, [cert] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess,
              SecTrustEvaluateWithError(trust, nil) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              response.url == endpoint.url(pairing: pairing), response.mimeType == "application/json",
              response.expectedContentLength <= Int64(maximum) else {
            completionHandler(.cancel)
            let status = (response as? HTTPURLResponse)?.statusCode
            finish(.failure(error(status == 401 ? "配对已过期或失效，请在电脑重新生成二维码。" : "电脑未返回有效档案，旧档案仍保留。")))
            return
        }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !finished else { return }
        guard buffer.count + data.count <= maximum else {
            finish(.failure(error("档案过大，已停止同步。")))
            return
        }
        buffer.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError failure: Error?) {
        guard !finished else { return }
        if failure != nil {
            finish(.failure(error("连接失败。请允许本地网络访问，确认同一 Wi-Fi、电脑已开启同步，证书匹配且防火墙允许专用网络。旧档案仍保留。")))
            return
        }
        do {
            guard var value = try JSONSerialization.jsonObject(with: buffer) as? [String: Any],
                  let revision = value["revision"] as? String, LocalSyncPairing.matches(revision, "^[a-f0-9]{64}$"),
                  let archive = value["archive"] as? [String: Any], archive["format"] as? String == "nioh2-character-assets",
                  archive["version"] as? String == "1.0.0", archive["character"] is [String: Any],
                  archive["builds"] is [Any] else { throw error("电脑返回的档案无效，旧档案仍保留。") }
            if pairing {
                guard let token = value["deviceToken"] as? String else { throw LocalSyncPairing.invalid }
                let saved = try LocalSyncPairing(host: endpoint.host, port: endpoint.port, pin: endpoint.pin, token: token).validated()
                try LocalSyncKeychain.save(saved)
            }
            value.removeValue(forKey: "deviceToken")
            // JS performs full archive validation and atomic IndexedDB persistence before success UI.
            finish(.success(["archive": archive, "revision": revision]))
        } catch {
            finish(.failure(self.error("无法保存有效配对信息，请重新生成二维码后重试。旧档案仍保留。")))
        }
    }
}
