import Foundation

// Foundation-only protocol boundary; also compiled by scripts/check-ios-core.sh.
struct LocalSyncPairing: Codable, Equatable {
    let host: String
    let port: Int
    let pin: String
    let token: String

    static let invalid = NSError(domain: "NiohLocalSync", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "配对信息无效，请重新扫描电脑二维码。"])

    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) == (value.startIndex..<value.endIndex)
    }

    static func isPrivateIPv4(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let numbers = parts.compactMap { part -> Int? in
            guard matches(String(part), "^[0-9]{1,3}$"), let n = Int(part), n <= 255,
                  String(n) == part else { return nil }
            return n
        }
        guard numbers.count == 4 else { return false }
        return numbers[0] == 10 || (numbers[0] == 172 && (16...31).contains(numbers[1]))
            || (numbers[0] == 192 && numbers[1] == 168)
    }

    func validated() throws -> LocalSyncPairing {
        guard Self.isPrivateIPv4(host), (1024...65535).contains(port),
              Self.matches(pin, "^[a-f0-9]{64}$"),
              Self.matches(token, "^[A-Za-z0-9_-]{43}$") else { throw Self.invalid }
        return self
    }

    static func parse(_ qr: String) throws -> LocalSyncPairing {
        let prefix = "niohcompanion://pair#"
        guard qr.utf8.count <= 2048, qr.hasPrefix(prefix) else { throw invalid }
        var fields: [String: String] = [:]
        for field in qr.dropFirst(prefix.count).split(separator: "&", omittingEmptySubsequences: false) {
            let pair = field.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard pair.count == 2, let key = String(pair[0]).removingPercentEncoding,
                  let value = String(pair[1]).removingPercentEncoding,
                  fields[key] == nil else { throw invalid }
            fields[key] = value
        }
        guard Set(fields.keys) == Set(["host", "port", "pin", "token"]),
              let portText = fields["port"], matches(portText, "^[1-9][0-9]{3,4}$"),
              let port = Int(portText) else { throw invalid }
        return try LocalSyncPairing(host: fields["host"]!, port: port,
                                    pin: fields["pin"]!, token: fields["token"]!).validated()
    }

    func url(pairing: Bool) -> URL {
        // Only use on a validated instance: no hostnames, redirects or arbitrary URLs.
        URL(string: "https://\(host):\(port)\(pairing ? "/v1/pair" : "/v1/pull")")!
    }
}
