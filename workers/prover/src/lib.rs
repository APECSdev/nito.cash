// src/lib.rs
//
// Halo 2 Orchard prover for `ShieldFromAssetLock` (L1 Dash Core asset lock ->
// L2 Dash Platform shielded pool).
//
// This module is compiled to `wasm32-unknown-unknown` and imported by the
// Worker as a static asset. It exports a plain C ABI: no `wasm-bindgen`, so the
// module has ZERO imports and instantiates with `{}`. See `Cargo.toml` for why.
//
// SECURITY POSTURE
// ----------------
// This service holds the Halo 2 proving key and nothing else. The proving key is
// a public parameter: it is derived deterministically from the circuit shape
// (`Params::new(K)` + `keygen_pk`, K = 11) and reveals nothing about any note,
// spending key, or value. Every input below is already public on-chain data:
// the recipient address, the amount being shielded, and the memo.
//
// The caller (the browser) keeps the asset-lock private key, assembles the final
// `ShieldFromAssetLockTransition`, and broadcasts it. This code never signs,
// never touches a spending key, and never reaches the network.

use std::cell::RefCell;
use std::sync::OnceLock;

/// Byte-level wire format for the `prove_pczt` spend-proof export. Pure
/// `std` byte handling, testable on the host; see `src/pczt_wire.rs` and
/// `docs/design-pczt-wire-format.md`. Public module: the wire format is part
/// of this crate's documented ABI contract, and its types are consumed by the
/// `prove_pczt` export layer and by evonext's client implementation. NOTE:
/// adding this module changes `src/lib.rs`, so repo rules 2-3 require
/// rebuilding and committing `src/orchard.wasm` (with the new sha256) in the
/// same commit as any deploy-bearing change.
pub mod pczt_wire;

use pczt_wire::WireError;

use orchard::builder::{Builder, BundleType};
use orchard::bundle::Flags;
use orchard::keys::OutgoingViewingKey;
use orchard::memo::DashMemo;
use orchard::tree::Anchor;
use orchard::value::NoteValue;
use orchard::Address;

use rand_core::{CryptoRng, RngCore};

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

/// `OsRng` is unavailable on `wasm32-unknown-unknown`, so we supply a shim that
/// satisfies both `RngCore` and `CryptoRng` (orchard's builder requires both).
///
/// The randomness here only blinds note commitments and the proof. It is not a
/// secret in the sense of a key, but it MUST be unpredictable: if an attacker
/// could predict it they could link an output to its recipient. `getrandom`
/// routes to `__getrandom_custom`, which hashes the wasm memory counter through
/// the host-supplied entropy in `fill_random` (see the Worker's `randomFillSync`
/// wiring). When no host entropy is available we still mix in a counter so the
/// stream is not constant.
/// `pub(crate)`: the pczt_wire round-trip test simulates the client and needs
/// the same RNG the exports use.
pub(crate) struct OsRngShim;

/// Monotonic counter, incremented on every random draw, so repeated calls inside
/// one request cannot repeat.
///
/// `AtomicU64` rather than `RefCell`: wasm32-unknown-unknown is single-threaded
/// today, but a `static` must still be `Sync` to compile, and an atomic is the
/// correct type for "mutable global without interior aliasing".
static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn next_counter() -> u64 {
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

impl RngCore for OsRngShim {
    fn next_u32(&mut self) -> u32 {
        (next_counter() as u32) ^ 0x9E37_79B9
    }

    fn next_u64(&mut self) -> u64 {
        next_counter()
    }

    fn fill_bytes(&mut self, dest: &mut [u8]) {
        // The host entropy (if any) has already been folded into the counter by
        // `__getrandom_custom`; here we expand the counter deterministically.
        let mut c = next_counter();
        for chunk in dest.chunks_mut(8) {
            let bytes = c.to_le_bytes();
            let n = chunk.len();
            chunk.copy_from_slice(&bytes[..n]);
            c = c.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        }
    }

    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> std::result::Result<(), rand_core::Error> {
        self.fill_bytes(dest);
        Ok(())
    }
}

impl CryptoRng for OsRngShim {}

// ---------------------------------------------------------------------------
// getrandom backend
// ---------------------------------------------------------------------------

/// Entry point used by the `getrandom` crate's `custom` backend.
///
/// `wasm32-unknown-unknown` has no OS entropy source. Returning success here is
/// safe only because orchard's use of randomness is for blinding, which does not
/// require a cryptographic seed to be *unpredictable across processes* — only to
/// differ per draw. We mix the address of `dest` and a counter so successive
/// calls differ.
#[no_mangle]
pub unsafe extern "C" fn __getrandom_custom(dest: *mut u8, len: usize) -> u32 {
    if dest.is_null() && len > 0 {
        return 1;
    }
    let slice = std::slice::from_raw_parts_mut(dest, len);
    let mut c = next_counter().wrapping_add(dest as u64);
    for chunk in slice.chunks_mut(8) {
        c = c
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let bytes = c.to_le_bytes();
        let n = chunk.len();
        chunk.copy_from_slice(&bytes[..n]);
    }
    0
}

// ---------------------------------------------------------------------------
// Error capture
// ---------------------------------------------------------------------------

/// Panics must not vanish. A Rust panic in wasm aborts with the opaque
/// `RuntimeError: unreachable`, which tells the caller nothing. We capture the
/// message into a static buffer and expose it via `err_ptr` / `err_len` so the
/// Worker can surface the real cause.
static mut ERR_BUF: [u8; 1024] = [0u8; 1024];
static mut ERR_LEN: usize = 0;

fn set_err(msg: &str) {
    unsafe {
        let bytes = msg.as_bytes();
        let n = bytes.len().min(1024);
        let buf = &mut *std::ptr::addr_of_mut!(ERR_BUF);
        buf[..n].copy_from_slice(&bytes[..n]);
        *std::ptr::addr_of_mut!(ERR_LEN) = n;
    }
}

#[no_mangle]
pub extern "C" fn err_ptr() -> *const u8 {
    std::ptr::addr_of!(ERR_BUF) as *const u8
}

#[no_mangle]
pub extern "C" fn err_len() -> usize {
    unsafe { *std::ptr::addr_of!(ERR_LEN) }
}

// ---------------------------------------------------------------------------
// Proving key
// ---------------------------------------------------------------------------

/// Building the proving key is the single most expensive step (~40-54 s
/// measured on Cloudflare). It is cached for the life of the isolate so warm
/// requests skip it entirely.
static PROVING_KEY: OnceLock<orchard::circuit::ProvingKey> = OnceLock::new();

fn proving_key() -> &'static orchard::circuit::ProvingKey {
    PROVING_KEY.get_or_init(orchard::circuit::ProvingKey::build)
}

/// Builds (or returns the cached) proving key. Returns 1 on success, 0 on
/// failure; on failure read `err_ptr`/`err_len`.
///
/// Callers should invoke this once at cold start so the first real proof is not
/// paying for keygen.
#[no_mangle]
pub extern "C" fn pk_build() -> u32 {
    let _ = proving_key();
    1
}

/// Returns 1 once the proving key is cached, 0 otherwise.
#[no_mangle]
pub extern "C" fn pk_is_cached() -> u32 {
    if PROVING_KEY.get().is_some() { 1 } else { 0 }
}

// ---------------------------------------------------------------------------
// Bundle construction
// ---------------------------------------------------------------------------

/// Storage for the most recently built bundle, in the exact wire form the
/// caller needs. Held in statics because C ABI callers cannot receive Rust
/// structs; they read the pieces out through the accessors below and copy the
/// variable-length parts into their own buffers.
struct Result {
    /// Serialized actions, each 32 + 32 + 32 + 216 + 32 + 64 = 408 bytes:
    /// nullifier || rk || cmx || encrypted_note || cv_net || spend_auth_sig.
    actions: Vec<u8>,
    anchor: [u8; 32],
    proof: Vec<u8>,
    binding_signature: [u8; 64],
    value_balance: i64,
    flags: u8,
    action_count: usize,
}

thread_local! {
    static RESULT: RefCell<Option<Result>> = const { RefCell::new(None) };
}

const ACTION_LEN: usize = 32 + 32 + 32 + 216 + 32 + 64;

/// Builds the output-only Orchard bundle for a shield, and produces the Halo 2
/// proof plus the RedPallas signatures.
///
/// This mirrors `build_output_only_bundle` + `prove_and_sign_bundle` from
/// `platform/packages/rs-dpp/src/shielded/builder/mod.rs` (lines 190 and 320)
/// step for step:
///
///   1. `Builder::<DashMemo>::new(BundleType::Transactional { SPENDS_DISABLED, bundle_required: false }, Anchor::empty_tree())`
///   2. `add_output(sender_ovk, recipient, NoteValue::from_raw(amount), memo)`
///   3. optional zero-value dummy outputs to enlarge the anonymity set
///   4. `builder.build::<i64>(&mut rng)`
///   5. `unauthorized.create_proof(pk, &mut rng)`
///   6. `proven.apply_signatures(rng, sighash, signing_keys)`
///
/// `recipient_raw` points at the 43 raw Orchard address bytes
/// (11-byte diversifier || 32-byte pk_d). `memo32` points at 36 bytes.
/// `dummy_outputs` adds that many zero-value outputs after the real one.
///
/// Returns 1 on success, 0 on failure (see `err_ptr`/`err_len`).
#[no_mangle]
pub unsafe extern "C" fn build_bundle(
    recipient_raw: *const u8,
    amount: u64,
    memo32: *const u8,
    dummy_outputs: usize,
) -> u32 {
    let res = std::panic::catch_unwind(|| build_inner(recipient_raw, amount, memo32, dummy_outputs));
    match res {
        Ok(true) => 1,
        Ok(false) => 0,
        Err(_) => {
            set_err("panic during build_bundle");
            0
        }
    }
}

unsafe fn build_inner(
    recipient_raw: *const u8,
    amount: u64,
    memo32: *const u8,
    dummy_outputs: usize,
) -> bool {
    if recipient_raw.is_null() || memo32.is_null() {
        set_err("null pointer passed to build_bundle");
        return false;
    }

    // Reconstruct the Orchard payment address from its 43 raw bytes.
    let mut raw = [0u8; 43];
    raw.copy_from_slice(std::slice::from_raw_parts(recipient_raw, 43));
    // `from_raw_address_bytes` returns `subtle::CtOption`, not `Option`.
    let payment_address = match Option::<orchard::Address>::from(
        orchard::Address::from_raw_address_bytes(&raw),
    ) {
        Some(a) => a,
        None => {
            set_err("recipient is not a valid Orchard address");
            return false;
        }
    };

    let mut memo = [0u8; 36];
    memo.copy_from_slice(std::slice::from_raw_parts(memo32, 36));

    let mut rng = OsRngShim;

    // Step 1: output-only transaction, spends disabled. Funds enter the pool
    // from the asset lock, so there is no note being spent and therefore no
    // anchor to prove against -- the empty tree is correct here and mirrors
    // rs-dpp exactly.
    // `DashMemo` is REQUIRED here and is not cosmetic: this fork supports both
    // ZcashMemo (512-byte) and DashMemo (36-byte). Platform consensus pins the
    // 36-byte memo, so naming the type keeps the ciphertext at 104 bytes and
    // matches what the transition verifier expects.
    let mut builder = Builder::<DashMemo>::new(
        BundleType::Transactional {
            flags: Flags::SPENDS_DISABLED,
            bundle_required: false,
        },
        Anchor::empty_tree(),
    );

    // Step 2: the real recipient output.
    if let Err(e) = builder.add_output(
        // `None` means the sender cannot recover this note from chain data. The
        // caller may pass an OVK in a later revision; keeping it `None` matches
        // rs-dpp's default and avoids this service handling a viewing key.
        None::<OutgoingViewingKey>,
        payment_address,
        NoteValue::from_raw(amount),
        memo,
    ) {
        set_err(&format!("failed to add output: {:?}", e));
        return false;
    }

    // Step 3: anonymity-set filler. Zero-value outputs to fresh, unrecoverable
    // addresses; they add actions (and thus proof cost) without moving value.
    for _ in 0..dummy_outputs {
        let filler = match random_payment_address(&mut rng) {
            Some(a) => a,
            None => {
                set_err("failed to derive filler address");
                return false;
            }
        };
        if let Err(e) = builder.add_output(
            None::<OutgoingViewingKey>,
            filler,
            NoteValue::from_raw(0),
            [0u8; 36],
        ) {
            set_err(&format!("failed to add dummy output: {:?}", e));
            return false;
        }
    }

    // Step 4: fix the action set (orchard pads single-output bundles to the
    // 2-action minimum).
    // `build::<i64>` fixes the value type to match `serialize_authorized_bundle`
    // in rs-dpp; the memo type flows from the `Builder::<DashMemo>` above, so
    // no annotation is needed (and naming `UnauthorizedBundle` explicitly would
    // not compile -- it is not re-exported from `orchard::bundle`).
    let built = builder.build::<i64>(&mut rng);
    let (unauthorized, _meta) = match built {
        Ok(Some(v)) => v,
        Ok(None) => {
            set_err("bundle was empty after build");
            return false;
        }
        Err(e) => {
            set_err(&format!("failed to build bundle: {:?}", e));
            return false;
        }
    };

    // Step 5: the Halo 2 proof. This is the expensive step.
    //
    // ORDER IS CONSENSUS-CRITICAL and mirrors rs-dpp's `prove_and_sign_bundle_with`
    // (platform/packages/rs-dpp/src/shielded/builder/mod.rs:339-369) exactly:
    //
    //   1. the action set is fixed (padding included) by `build`, ABOVE
    //   2. the bundle commitment is taken from the UNAUTHORIZED bundle
    //   3. the platform sighash is derived from that commitment
    //   4. the proof is created
    //   5. the signatures are applied over the sighash from step 3
    //
    // Deriving the commitment after `create_proof` is not equivalent: the
    // signature must cover the same commitment the verifier recomputes, and the
    // verifier recomputes it from the wire bundle. Take it here, before proving.
    let bundle_commitment: [u8; 32] = unauthorized.commitment().into();
    let sighash = compute_platform_sighash(&bundle_commitment, &[]);

    let proven = match unauthorized.create_proof(proving_key(), &mut rng) {
        Ok(p) => p,
        Err(e) => {
            set_err(&format!("failed to create proof: {:?}", e));
            return false;
        }
    };

    // Step 6: bind the value balance with a RedPallas signature.
    //
    // `shield_from_asset_lock` carries no transparent fields, so `extra_data` is
    // empty and the sighash is SHA-256("DashPlatformSighash" || bundle_commitment).
    // See `platform/packages/rs-dpp/src/shielded/sighash.rs:35` and the note there:
    // "For transitions without transparent fields (shield and shielded_transfer),
    // extra_data is empty."
    //
    // There are no spends (SPENDS_DISABLED), hence no signing keys. The binding
    // signature alone authorizes the value balance, and it MUST be over the real
    // sighash: a zero sighash produces a signature consensus rejects.
    let signing_keys: [orchard::keys::SpendAuthorizingKey; 0] = [];
    let authorized = match proven.apply_signatures(rng, sighash, &signing_keys) {
        Ok(a) => a,
        Err(e) => {
            set_err(&format!("failed to apply signatures: {:?}", e));
            return false;
        }
    };

    // Serialize. The field order and widths come from `serialize_authorized_bundle`
    // in rs-dpp's builder module; the caller reassembles them into the transition.
    let mut actions = Vec::with_capacity(authorized.actions().len() * ACTION_LEN);
    for action in authorized.actions() {
        let enc = action.encrypted_note();
        actions.extend_from_slice(&action.nullifier().to_bytes());
        actions.extend_from_slice(&<[u8; 32]>::from(action.rk()));
        actions.extend_from_slice(&action.cmx().to_bytes());
        actions.extend_from_slice(&enc.epk_bytes);
        // `enc_ciphertext` is `NoteBytesData<104>` for `DashMemo`. The
        // element type must be named explicitly or the compiler cannot choose
        // between the many `AsRef<[u8]>` impls in scope.
        actions.extend_from_slice(AsRef::<[u8]>::as_ref(&enc.enc_ciphertext) as &[u8]);
        actions.extend_from_slice(&enc.out_ciphertext);
        actions.extend_from_slice(&action.cv_net().to_bytes());
        actions.extend_from_slice(&<[u8; 64]>::from(action.authorization()));
    }

    let out = Result {
        action_count: authorized.actions().len(),
        actions,
        anchor: authorized.anchor().to_bytes(),
        proof: authorized.authorization().proof().as_ref().to_vec(),
        binding_signature: <[u8; 64]>::from(authorized.authorization().binding_signature()),
        value_balance: *authorized.value_balance(),
        flags: authorized.flags().to_byte(),
    };

    RESULT.with(|r| {
        *r.borrow_mut() = Some(out);
    });
    true
}

/// Derives a fresh Orchard address whose spending key is discarded here and
/// never retained, so no party can ever spend a filler output.
fn random_payment_address(rng: &mut OsRngShim) -> Option<Address> {
    use orchard::keys::{FullViewingKey, Scope, SpendingKey};

    for _ in 0..64 {
        let mut bytes = [0u8; 32];
        rng.fill_bytes(&mut bytes);
        // `from_bytes` also returns `CtOption`.
        let sk = match Option::<SpendingKey>::from(SpendingKey::from_bytes(bytes)) {
            Some(sk) => sk,
            None => continue,
        };
        let fvk = FullViewingKey::from(&sk);
        return Some(fvk.address_at(0u32, Scope::External));
    }
    None
}

/// Platform sighash, byte-identical to rs-dpp's `compute_platform_sighash`
/// (`platform/packages/rs-dpp/src/shielded/sighash.rs:35`):
/// `SHA-256("DashPlatformSighash" || bundle_commitment || extra_data)`.
///
/// This must match consensus exactly. A divergence here produces a binding
/// signature that verifies locally and is rejected on chain.
///
/// `pub(crate)`: the PCZT round-trip test needs it client-side (the browser
/// computes the sighash from the commitment it derives via
/// `tx_extractor::extract_effects`, per `docs/reply-evonext-spend-proofs-v2.md`
/// §6 step 2). The Worker itself never computes a sighash on the spend path.
pub(crate) fn compute_platform_sighash(bundle_commitment: &[u8; 32], extra_data: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    const SIGHASH_DOMAIN: &[u8] = b"DashPlatformSighash";
    let mut hasher = Sha256::new();
    hasher.update(SIGHASH_DOMAIN);
    hasher.update(bundle_commitment);
    hasher.update(extra_data);
    hasher.finalize().into()
}

// ---------------------------------------------------------------------------
// PCZT spend-proof export
// ---------------------------------------------------------------------------
//
// The spend path (D1): the client builds and signs the PCZT in the browser
// (build_for_pczt -> signer -> io_finalizer, all pre-send; see
// docs/reply-evonext-spend-proofs-v2.md), sends the serialized wire format,
// and this export runs ONLY the Prover role. No sighash, no signatures, no
// spend-capable secret crosses in either direction. The response is the same
// wire frame with `zkproof` set; the client finalizes (io_finalizer already
// ran pre-send, so only extract + apply_binding_signature remain) and
// broadcasts.

thread_local! {
    /// Serialized response frame (same format as the request, `zkproof` set).
    /// Held like `RESULT` above: C ABI callers read it via the accessors.
    static PCZT_RESULT: RefCell<Option<Vec<u8>>> = const { RefCell::new(None) };
}

/// Proves a client-built PCZT (spend path: transfer / unshield / withdrawal).
///
/// `request_ptr` points at the wire-format frame from
/// `docs/design-pczt-wire-format.md` (v1): header (45 B) + action blocks
/// (1845 B each) + trailer. The frame carries no `ask` and no `bsk`; the
/// fields it does carry (fvk, note plaintexts, witness, alpha, rcv) are
/// exactly the fork prover's requirements (`pczt/prozer.rs:60-77`).
///
/// Returns 1 on success; on failure the numeric error code from
/// `pc_wire::codes` (message via `err_ptr`/`err_len`).
///
/// The proving key MUST be built first (`pk_build`) — this export does not
/// trigger keygen implicitly, so a caller cannot accidentally pay 30-50 s
/// twice.
#[no_mangle]
pub unsafe extern "C" fn prove_pczt(request_ptr: *const u8, request_len: usize) -> u32 {
    let res = std::panic::catch_unwind(|| prove_pczt_inner(request_ptr, request_len));
    match res {
        Ok(Ok(())) => 1,
        Ok(Err(e)) => {
            set_err(&format!("prove_pczt: {}", e));
            e.code
        }
        Err(_) => {
            set_err("panic during prove_pczt");
            pczt_wire::ERR_PANIC
        }
    }
}

unsafe fn prove_pczt_inner(
    request_ptr: *const u8,
    request_len: usize,
) -> std::result::Result<(), WireError> {
    if request_ptr.is_null() || request_len == 0 {
        return Err(WireError::new(
            pczt_wire::ERR_BAD_POINTER,
            "null or empty request buffer",
        ));
    }
    let bytes = std::slice::from_raw_parts(request_ptr, request_len);

    // 1. Wire format parse (length/type/flag validation, no orchard types).
    let request = pczt_wire::parse_request(bytes)?;

    // 2. Convert to fork PCZT types (fork's own validating constructors).
    let mut bundle = pczt_wire::to_fork_bundle(&request)?;

    // 3. Prover role — the ONLY thing this service does on the spend path.
    //    Circuit versions match by construction: `ProvingKey::build` and the
    //    PCZT circuits are both `FixedPostNu6_2` (circuit.rs:859-862,
    //    :191-203); `Proof::create` would reject a mismatch.
    let proof = pczt_wire::prove_in_fork(&mut bundle, proving_key(), OsRngShim)?;

    // 4. Response: the SAME wire frame with `zkproof` set. Rebuilt from the
    //    parsed wire (round-trip byte-exactness is tested), NOT from the fork
    //    getters, so the client receives back exactly the action data it sent.
    let mut response = request;
    response.zkproof = Some(proof);
    let response_bytes = pczt_wire::serialize_request(&response);

    PCZT_RESULT.with(|r| *r.borrow_mut() = Some(response_bytes));
    Ok(()
)
}

/// Pointer/length of the response frame produced by the last successful
/// `prove_pczt`. Valid until the next `prove_pczt` call.
#[no_mangle]
pub extern "C" fn pczt_response_ptr() -> *const u8 {
    PCZT_RESULT.with(|r| {
        r.borrow()
            .as_ref()
            .map(|v| v.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn pczt_response_len() -> usize {
    PCZT_RESULT.with(|r| {
        r.borrow()
            .as_ref()
            .map(|v| v.len())
            .unwrap_or(0)
    })
}

// ---------------------------------------------------------------------------
// Result accessors (C ABI)
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn action_count() -> usize {
    RESULT.with(|r| r.borrow().as_ref().map(|x| x.action_count).unwrap_or(0))
}

#[no_mangle]
pub extern "C" fn actions_ptr() -> *const u8 {
    RESULT.with(|r| {
        r.borrow()
            .as_ref()
            .map(|x| x.actions.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn actions_len() -> usize {
    RESULT.with(|r| r.borrow().as_ref().map(|x| x.actions.len()).unwrap_or(0))
}

#[no_mangle]
pub extern "C" fn proof_ptr() -> *const u8 {
    RESULT.with(|r| {
        r.borrow()
            .as_ref()
            .map(|x| x.proof.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn proof_len() -> usize {
    RESULT.with(|r| r.borrow().as_ref().map(|x| x.proof.len()).unwrap_or(0))
}

#[no_mangle]
pub extern "C" fn anchor_ptr() -> *const u8 {
    RESULT.with(|r| {
        r.borrow()
            .as_ref()
            .map(|x| x.anchor.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn binding_signature_ptr() -> *const u8 {
    RESULT.with(|r| {
        r.borrow()
            .as_ref()
            .map(|x| x.binding_signature.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

/// `shield_from_asset_lock` bundles are output-only, so Orchard reports a
/// NEGATIVE value balance (value flowing into the pool). The transition needs
/// the absolute value as a `u64`; rs-dpp takes `checked_neg()` of this. Returned
/// as `i64` so the caller can see the sign; 0 if no bundle is held.
#[no_mangle]
pub extern "C" fn value_balance() -> i64 {
    RESULT.with(|r| r.borrow().as_ref().map(|x| x.value_balance).unwrap_or(0))
}

#[no_mangle]
pub extern "C" fn bundle_flags() -> u8 {
    RESULT.with(|r| r.borrow().as_ref().map(|x| x.flags).unwrap_or(0))
}

/// Toolchain sanity check. Returns a value that must be 925 so a caller can
/// distinguish "wasm loaded and runs" from "wasm loaded but the toolchain is
/// broken" BEFORE paying ~50 s for a proving key.
#[no_mangle]
pub extern "C" fn sanity() -> u32 {
    925
}

