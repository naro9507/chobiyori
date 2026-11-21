// The native side returns a secret obtainable only through the platform credential.
// Only the public challenge / hardware-wrapped key material goes into the envelope.
use base64::{engine::general_purpose::STANDARD, Engine};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};

pub(super) fn failed() -> AppError {
    AppError::new(ErrorCode::DeviceAuthFailed)
}

pub(super) fn random<const N: usize>() -> AppResult<[u8; N]> {
    let mut bytes = [0; N];
    SystemRandom::new().fill(&mut bytes).map_err(|_| failed())?;
    Ok(bytes)
}

#[derive(Serialize, Deserialize)]
pub(super) struct Envelope {
    handle: String,
    nonce: [u8; 12],
    ciphertext: String,
}

#[cfg(any(windows, target_os = "macos"))]
fn native(create: bool, input: &[u8]) -> AppResult<(Vec<u8>, [u8; 32])> {
    extern "C" {
        fn chobiyori_device_key(
            create: i32,
            input: *const u8,
            size: usize,
            handle: *mut u8,
            capacity: usize,
            key: *mut u8,
        ) -> i32;
    }
    let mut handle = vec![0; 4096];
    let mut key = [0; 32];
    let length = unsafe {
        chobiyori_device_key(
            create.into(),
            input.as_ptr(),
            input.len(),
            handle.as_mut_ptr(),
            handle.len(),
            key.as_mut_ptr(),
        )
    };
    if length <= 0 || length as usize > handle.len() {
        return Err(failed());
    }
    handle.truncate(length as usize);
    Ok((handle, key))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn native(_: bool, _: &[u8]) -> AppResult<(Vec<u8>, [u8; 32])> {
    Err(failed())
}

fn cipher(key: [u8; 32]) -> AppResult<aead::LessSafeKey> {
    Ok(aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &key).map_err(|_| failed())?,
    ))
}

pub(super) struct DeviceKey {
    handle: String,
    cipher: aead::LessSafeKey,
}

impl DeviceKey {
    #[cfg(test)]
    pub(super) fn test_key() -> Self {
        Self {
            handle: STANDARD.encode([0; 32]),
            cipher: cipher([0; 32]).unwrap(),
        }
    }

    pub(super) fn seal(&self, mut data: Vec<u8>) -> AppResult<Envelope> {
        let nonce = random()?;
        self.cipher
            .seal_in_place_append_tag(
                aead::Nonce::assume_unique_for_key(nonce),
                aead::Aad::from(b"chobiyori-login-v1"),
                &mut data,
            )
            .map_err(|_| failed())?;
        Ok(Envelope {
            handle: self.handle.clone(),
            nonce,
            ciphertext: STANDARD.encode(data),
        })
    }

    pub(super) fn open(&self, envelope: &Envelope) -> AppResult<Vec<u8>> {
        let mut bytes = STANDARD
            .decode(&envelope.ciphertext)
            .map_err(|_| failed())?;
        let length = self
            .cipher
            .open_in_place(
                aead::Nonce::assume_unique_for_key(envelope.nonce),
                aead::Aad::from(b"chobiyori-login-v1"),
                &mut bytes,
            )
            .map_err(|_| failed())?
            .len();
        bytes.truncate(length);
        Ok(bytes)
    }
}

impl Envelope {
    pub(super) fn authenticate(&self) -> AppResult<DeviceKey> {
        let handle = STANDARD.decode(&self.handle).map_err(|_| failed())?;
        let (_, key) = native(false, &handle)?;
        Ok(DeviceKey {
            handle: self.handle.clone(),
            cipher: cipher(key)?,
        })
    }
}

pub(super) fn seal(data: Vec<u8>) -> AppResult<Envelope> {
    let (handle, key) = native(true, &random::<32>()?)?;
    DeviceKey {
        handle: STANDARD.encode(handle),
        cipher: cipher(key)?,
    }
    .seal(data)
}
