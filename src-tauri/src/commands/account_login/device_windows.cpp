// Windows Hello's RSA PKCS#1 v1.5 signature is deterministic for a given
// challenge. Its digest wraps the local secret. Never persist the signature.
#include <windows.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Credentials.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Security.Cryptography.Core.h>
#include <cstring>
using namespace winrt;
using namespace Windows::Security::Credentials;
using namespace Windows::Security::Cryptography;
using namespace Windows::Security::Cryptography::Core;

extern "C" int chobiyori_device_key(int create, uint8_t const* input, size_t size,
    uint8_t* handle, size_t capacity, uint8_t* key) noexcept {
    if (size != 32 || capacity < size) return -1;
    try {
        // Called on a background thread, never block the desktop UI.
        winrt::init_apartment();
        struct Apartment { ~Apartment() { winrt::uninit_apartment(); } } apartment;
        if (!KeyCredentialManager::IsSupportedAsync().get()) return -1;
        auto name = L"jp.dcs.accounting.book-login.v1";
        auto credential = KeyCredentialManager::OpenAsync(name).get();
        if (create && credential.Status() == KeyCredentialStatus::NotFound) {
            credential = KeyCredentialManager::RequestCreateAsync(name,
                KeyCredentialCreationOption::FailIfExists).get();
        }
        if (credential.Status() != KeyCredentialStatus::Success) return -1;
        auto challenge = CryptographicBuffer::CreateFromByteArray({input, input + size});
        auto signedValue = credential.Credential().RequestSignAsync(challenge).get();
        if (signedValue.Status() != KeyCredentialStatus::Success) return -1;
        auto digest = HashAlgorithmProvider::OpenAlgorithm(HashAlgorithmNames::Sha256())
            .HashData(signedValue.Result());
        com_array<uint8_t> bytes;
        CryptographicBuffer::CopyToByteArray(digest, bytes);
        if (bytes.size() != 32) return -1;
        std::memcpy(key, bytes.data(), 32);
        std::memcpy(handle, input, size);
        return static_cast<int>(size);
    } catch (...) { return -1; }
}
