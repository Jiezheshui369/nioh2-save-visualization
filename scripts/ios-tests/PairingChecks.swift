import Foundation

@main
struct PairingChecks {
    struct Case: Decodable { let name: String; let qr: String; let valid: Bool }
    static func main() throws {
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
        var failures: [String] = []
        for item in cases {
            let parsed = try? LocalSyncPairing.parse(item.qr)
            if (parsed != nil) != item.valid { failures.append(item.name) }
            if let parsed {
                precondition(parsed.url(pairing: true).path == "/v1/pair")
                precondition(parsed.url(pairing: false).scheme == "https")
                let restored = try JSONDecoder().decode(LocalSyncPairing.self, from: JSONEncoder().encode(parsed))
                let validated = try restored.validated()
                precondition(validated == parsed)
            }
        }
        guard failures.isEmpty else {
            fputs("Pairing checks failed: \(failures.joined(separator: ", "))\n", stderr)
            exit(1)
        }
        print("\(cases.count) Swift pairing cases passed; this is not an iOS TLS/UI test.")
    }
}
