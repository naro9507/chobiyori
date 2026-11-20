import CryptoKit
import Foundation
import LocalAuthentication
import Security

private struct Handle: Codable {
    let protectedKey: Data
    let peer: Data
}

@_cdecl("chobiyori_device_key")
public func deviceKey(_ create: Int32, _ input: UnsafePointer<UInt8>, _ size: Int,
                      _ output: UnsafeMutablePointer<UInt8>, _ capacity: Int,
                      _ key: UnsafeMutablePointer<UInt8>) -> Int32 {
    guard SecureEnclave.isAvailable else { return -1 }
    do {
        let context = LAContext()
        context.touchIDAuthenticationAllowableReuseDuration = 0
        context.localizedReason = Bundle.main.preferredLocalizations.first?.hasPrefix("ja") == true
            ? "帳日和の帳簿を開くために本人確認します。" : "Verify your identity to open Chobiyori."
        let privateKey: SecureEnclave.P256.KeyAgreement.PrivateKey
        let handle: Handle
        if create != 0 {
            guard let access = SecAccessControlCreateWithFlags(nil,
                kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                [.privateKeyUsage, .userPresence], nil) else { return -1 }
            privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access,
                authenticationContext: context)
            handle = Handle(protectedKey: privateKey.dataRepresentation,
                peer: P256.KeyAgreement.PrivateKey().publicKey.x963Representation)
        } else {
            handle = try JSONDecoder().decode(Handle.self, from: Data(bytes: input, count: size))
            privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(
                dataRepresentation: handle.protectedKey, authenticationContext: context)
        }
        let peer = try P256.KeyAgreement.PublicKey(x963Representation: handle.peer)
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: peer)
        let derived = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(),
            sharedInfo: Data("chobiyori-login-v1".utf8), outputByteCount: 32)
        let encoded = try JSONEncoder().encode(handle)
        guard encoded.count <= capacity else { return -1 }
        encoded.copyBytes(to: output, count: encoded.count)
        derived.withUnsafeBytes { key.update(from: $0.bindMemory(to: UInt8.self).baseAddress!, count: 32) }
        return Int32(encoded.count)
    } catch { return -1 }
}
