import Foundation
import Security

enum LocalSyncKeychain {
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.jiezheshuizz.niohcompanion.local-sync",
         kSecAttrAccount as String: "paired-computer"]
    }
    private static func failure() -> NSError {
        NSError(domain: "NiohLocalSync", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "无法读写手机配对凭据，请解锁设备后重试。"])
    }
    static func load() throws -> LocalSyncPairing? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw failure() }
        return try JSONDecoder().decode(LocalSyncPairing.self, from: data).validated()
    }
    static func save(_ pairing: LocalSyncPairing) throws {
        let data = try JSONEncoder().encode(pairing.validated())
        let values: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let updated = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if updated == errSecItemNotFound {
            var insert = query
            values.forEach { insert[$0.key] = $0.value }
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw failure() }
        } else if updated != errSecSuccess { throw failure() }
    }
    static func forget() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure() }
    }
}
