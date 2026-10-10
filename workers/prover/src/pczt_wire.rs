// src/pczt_wire.rs
//
// Byte-level wire format for the `prove_pczt` spend-proof export.
//
// SPEC: docs/design-pczt-wire-format.md (v1) in this repository. Every width
// below traces to a line in the pinned orchard fork (`dashpay/orchard`,
// checkout 38ac9c1); the spec cites those lines. This module is deliberately
// PURE `std` byte handling: it parses/serializes the frame into fixed-width
// arrays and Option fields and knows NOTHING about orchard types. Conversion
// to the fork's `pczt` types is the next layer, so this layer is testable on
// the host without instantiating a proving key.
//
// FORMAT (v1) — all integers little-endian:
//
//   header (45 bytes)
//     version u8 = 1
//     action_count u16
//     flags u8                       (bundle flags byte, `Flags::from_byte`)
//     value_sum magnitude u64        (Bundle::parse takes `(magnitude, is_negative)`)
//     value_sum is_negative u8       (0 or 1; other values are malformed)
//     anchor [u8; 32]
//   action_count x action block (1845 bytes each)
//     cv_net [u8; 32]
//     rcv        flag + [u8; 32]     (required by the prover)
//     spend section (1410 bytes), field order per fork `Spend::parse`:
//       nullifier [u8; 32]
//       rk [u8; 32]
//       spend_auth_sig flag + [u8; 64]
//       recipient flag + [u8; 43]    (required by the prover)
//       value flag + u64             (required by the prover)
//       rho flag + [u8; 32]          (required by the prover)
//       rseed flag + [u8; 32]        (required by the prover)
//       fvk flag + [u8; 96]          (required by the prover)
//       witness flag + position u32 + 32 x [u8; 32]  (required by the prover)
//       alpha flag + [u8; 32]        (required by the prover)
//       dummy_sk flag                (MUST be 0 in v1; server rejects 1)
//       zip32_derivation flag        (MUST be 0 in v1)
//       proprietary flag             (MUST be 0 in v1)
//     output section (370 bytes), field order per fork `Output::parse`:
//       cmx [u8; 32]
//       ephemeral_key [u8; 32]
//       enc_ciphertext [u8; 104]     (DashMemo pin: 36-byte memo ciphertext)
//       out_ciphertext [u8; 80]
//       recipient flag + [u8; 43]    (required by the prover)
//       value flag + u64             (required by the prover)
//       rseed flag + [u8; 32]        (required by the prover)
//       ock flag + [u8; 32]          (OPTIONAL even for proving: OVK policy "None")
//       user_address flag            (MUST be 0 in v1)
//       zip32_derivation flag        (MUST be 0 in v1)
//       proprietary flag             (MUST be 0 in v1)
//   trailer (>= 2 bytes)
//     zkproof flag                   (+ u32 length + bytes when present)
//     bsk flag                       (MUST be 0 in v1: bsk is derived
//                                     client-side by io_finalizer, never sent)
//
// SECURITY POSTURE (unchanged from README / D3): this format contains NO
// spend-capable secret. There is no `ask` field anywhere, `bsk` is forbidden
// on the wire, and `dummy_sk` must be stripped by the client before sending
// (the server rejects it). What the server necessarily receives — fvk, note
// plaintexts, witness, alpha, rcv — is exactly the fork prover's requirement
// (`pczt/prover.rs:60-77`), no more.

// ---------------------------------------------------------------------------
// Error codes (single source of truth; mirrors docs/design-pczt-wire-format.md §7)
// ---------------------------------------------------------------------------

/// Success is encoded as the export's return value 1; code 0 is unused.
///
/// The constants in this block are the ABI contract consumed by the export
/// layer (`prove_pczt`); until that layer lands, most are referenced only by
/// tests, hence the dead_code allowance.
#[allow(dead_code)]
pub mod codes {
    pub const ERR_OK_UNUSED: u32 = 0;
    pub const ERR_VERSION: u32 = 2;
    pub const ERR_TRUNCATED: u32 = 3;
    pub const ERR_BAD_FLAG_BYTE: u32 = 4;
    pub const ERR_FIELD_UNSUPPORTED: u32 = 5;
    pub const ERR_EXCESS_BYTES: u32 = 6;

    // Parse-error codes 7-25: one per `pczt::ParseError` variant, IN THE
    // FORK'S ENUM ORDER (`pczt/parse.rs:297-341`), so the 1:1 mapping is
    // auditable by reading the two lists side by side. Never collapsed.
    pub const ERR_INVALID_ANCHOR: u32 = 7;
    pub const ERR_INVALID_BSK: u32 = 8; // InvalidBindingSignatureSigningKey
    pub const ERR_INVALID_DUMMY_SK: u32 = 9;
    pub const ERR_INVALID_ENC_CIPHERTEXT: u32 = 10;
    pub const ERR_INVALID_CMX: u32 = 11; // InvalidExtractedNoteCommitment
    pub const ERR_INVALID_FVK: u32 = 12;
    pub const ERR_INVALID_NULLIFIER: u32 = 13;
    pub const ERR_INVALID_OUT_CIPHERTEXT: u32 = 14; // unreachable via fixed-width wire; kept for 1:1 parity
    pub const ERR_INVALID_RK: u32 = 15; // InvalidRandomizedKey
    pub const ERR_INVALID_RSEED: u32 = 16; // InvalidRandomSeed
    pub const ERR_INVALID_RECIPIENT: u32 = 17;
    pub const ERR_INVALID_RHO: u32 = 18;
    pub const ERR_INVALID_ALPHA: u32 = 19; // InvalidSpendAuthRandomizer
    pub const ERR_INVALID_CV_NET: u32 = 20; // InvalidValueCommitment
    pub const ERR_INVALID_RCV: u32 = 21; // InvalidValueCommitTrapdoor
    pub const ERR_INVALID_WITNESS: u32 = 22;
    pub const ERR_INVALID_ZIP32: u32 = 23;
    pub const ERR_MISSING_RHO: u32 = 24; // fork: rho required whenever rseed is set
    pub const ERR_BAD_FLAGS: u32 = 25; // UnexpectedFlagBitsSet

    // Frame-level codes that have no fork equivalent.
    pub const ERR_BAD_VALUE_SUM: u32 = 26;
    pub const ERR_NO_ACTIONS: u32 = 27;

    // Fallback for a `ParseError`/`ProverError` variant not present in the
    // pinned fork (`dashified-0.14.1`): both enums are #[non_exhaustive], so a
    // fork bump that adds variants must surface loudly here rather than being
    // collapsed into an unrelated code. Unreachable while the fork is pinned.
    pub const ERR_UNEXPECTED_FORK_ERROR: u32 = 28;

    // Prover-error codes 100-113: one per `pczt::ProverError` variant
    // (`pczt/prover.rs:123-146`), again never collapsed.
    pub const ERR_PROVER_MISSING_FVK: u32 = 100;
    pub const ERR_PROVER_MISSING_RSEED: u32 = 101;
    pub const ERR_PROVER_MISSING_RECIPIENT: u32 = 102;
    pub const ERR_PROVER_MISSING_RHO: u32 = 103;
    pub const ERR_PROVER_MISSING_ALPHA: u32 = 104;
    pub const ERR_PROVER_MISSING_VALUE: u32 = 105;
    pub const ERR_PROVER_MISSING_RCV: u32 = 106;
    pub const ERR_PROVER_MISSING_WITNESS: u32 = 107;
    pub const ERR_PROVER_INVALID_SPEND_NOTE: u32 = 108;
    pub const ERR_PROVER_INVALID_OUTPUT_NOTE: u32 = 109;
    pub const ERR_PROVER_RHO_MISMATCH: u32 = 110;
    pub const ERR_PROVER_WRONG_FVK: u32 = 111;
    pub const ERR_PROVER_IDENTITY_RK: u32 = 112;
    pub const ERR_PROVER_FAILED: u32 = 113;

    pub const ERR_PANIC: u32 = 200;
    pub const ERR_BAD_POINTER: u32 = 201;
}

pub use codes::*;

// ---------------------------------------------------------------------------
// Frame geometry
// ---------------------------------------------------------------------------

/// Header: version(1) + action_count(2) + flags(1) + magnitude(8)
/// + is_negative(1) + anchor(32).
pub const HEADER_LEN: usize = 45;

/// Spend section: nullifier(32) + rk(32) + sig(1+64) + recipient(1+43)
/// + value(1+8) + rho(1+32) + rseed(1+32) + fvk(1+96)
/// + witness(1+4+32*32) + alpha(1+32) + 3 forbidden-field flags.
pub const SPEND_SECTION_LEN: usize = 32 + 32 + (1 + 64) + (1 + 43) + (1 + 8)
    + (1 + 32) + (1 + 32) + (1 + 96) + (1 + 4 + 32 * 32) + (1 + 32) + 3;

/// Output section: cmx(32) + ephemeral_key(32) + enc(104) + out(80)
/// + recipient(1+43) + value(1+8) + rseed(1+32) + ock(1+32) + 3 forbidden flags.
pub const OUTPUT_SECTION_LEN: usize = 32 + 32 + 104 + 80 + (1 + 43) + (1 + 8)
    + (1 + 32) + (1 + 32) + 3;

/// Action block: cv_net(32) + rcv(1+32) + spend + output.
pub const ACTION_WIRE_LEN: usize = 32 + (1 + 32) + SPEND_SECTION_LEN + OUTPUT_SECTION_LEN;

/// Depth of the Orchard note commitment tree; the witness carries exactly this
/// many 32-byte path nodes (`NOTE_COMMITMENT_TREE_DEPTH` in the fork).
pub const TREE_DEPTH: usize = 32;

/// DashMemo ciphertext length (36-byte memo); see README's action layout.
pub const ENC_CIPHERTEXT_LEN: usize = 104;

// Compile-time cross-checks of the geometry against the spec text.
const _: () = assert!(HEADER_LEN == 45);
const _: () = assert!(SPEND_SECTION_LEN == 1410);
const _: () = assert!(OUTPUT_SECTION_LEN == 370);
const _: () = assert!(ACTION_WIRE_LEN == 1845);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Wire-level error: the export maps `code` to its return value and `message`
/// into `err_ptr`/`err_len` (same convention as `set_err` in `lib.rs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireError {
    pub code: u32,
    pub message: String,
}

impl WireError {
    /// `pub(crate)`: the export layer in `lib.rs` constructs frame-level
    /// errors (bad pointer) directly; everything else is built in this module.
    pub(crate) fn new(code: u32, message: impl Into<String>) -> Self {
        WireError {
            code,
            message: message.into(),
        }
    }

    fn truncated(need: usize, have: usize) -> Self {
        WireError::new(
            ERR_TRUNCATED,
            format!("frame truncated: need {} more bytes, have {}", need, have),
        )
    }

    fn bad_flag(field: &'static str, value: u8) -> Self {
        WireError::new(
            ERR_BAD_FLAG_BYTE,
            format!("field `{}`: flag byte must be 0 or 1, got {}", field, value),
        )
    }
    // (no `unsupported` helper: `Reader::forbidden` builds the message inline
    // so it can include the offending flag byte value in the diagnostics.)
}

impl core::fmt::Display for WireError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "error {}: {}", self.code, self.message)
    }
}

// ---------------------------------------------------------------------------
// Parsed structures (raw arrays; conversion to fork types is a later layer)
// ---------------------------------------------------------------------------

/// One parsed action block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireAction {
    pub cv_net: [u8; 32],
    pub rcv: Option<[u8; 32]>,
    pub spend: WireSpend,
    pub output: WireOutput,
}

/// Spend half. Field names mirror the fork's `Spend` struct
/// (`pczt.rs:137-216`). `zip32_derivation`, `dummy_sk` and `proprietary` are
/// rejected at the frame layer in v1 and therefore absent here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireSpend {
    pub nullifier: [u8; 32],
    pub rk: [u8; 32],
    pub spend_auth_sig: Option<[u8; 64]>,
    pub recipient: Option<[u8; 43]>,
    pub value: Option<u64>,
    pub rho: Option<[u8; 32]>,
    pub rseed: Option<[u8; 32]>,
    pub fvk: Option<[u8; 96]>,
    /// `(position, auth_path)`. Node ORDER (leaf-to-root vs root-to-leaf) is
    /// pinned by a fork round-trip test when the conversion layer lands
    /// (design doc §9.1); this layer preserves bytes verbatim.
    pub witness: Option<(u32, [[u8; 32]; TREE_DEPTH])>,
    pub alpha: Option<[u8; 32]>,
}

/// Output half. Field names mirror the fork's `Output` struct
/// (`pczt.rs:218-289`). Note the fork derives the output note's rho from the
/// SPEND nullifier (`Output::parse` takes `spend_nullifier`,
/// `pczt/parse.rs:214-215`), so no rho field exists on the output side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireOutput {
    pub cmx: [u8; 32],
    pub ephemeral_key: [u8; 32],
    pub enc_ciphertext: [u8; ENC_CIPHERTEXT_LEN],
    pub out_ciphertext: [u8; 80],
    pub recipient: Option<[u8; 43]>,
    pub value: Option<u64>,
    pub rseed: Option<[u8; 32]>,
    pub ock: Option<[u8; 32]>,
}

/// Fully parsed request. `version` is always 1 after successful parse (any
/// other value is rejected), and `action_count` always equals `actions.len()`
/// (the frame is exact-length checked).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestWire {
    pub action_count: u16,
    pub flags: u8,
    pub value_sum_magnitude: u64,
    pub value_sum_is_negative: bool,
    pub anchor: [u8; 32],
    pub actions: Vec<WireAction>,
    pub zkproof: Option<Vec<u8>>,
}

impl RequestWire {
    /// Serialized length of this request/response, computed from the fields so
    /// the writer can never disagree with the reader.
    pub fn wire_len(&self) -> usize {
        HEADER_LEN
            + self.actions.len() * ACTION_WIRE_LEN
            + 1 // zkproof flag
            + self.zkproof.as_ref().map(|p| 4 + p.len()).unwrap_or(0)
            + 1 // bsk flag (always absent in v1, still occupies its byte)
    }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/// Minimal bounds-checked cursor over the frame.
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], WireError> {
        let end = self.pos.checked_add(n).ok_or_else(|| {
            WireError::new(ERR_TRUNCATED, "frame length overflow")
        })?;
        if end > self.buf.len() {
            return Err(WireError::truncated(end - self.pos, self.buf.len() - self.pos));
        }
        let out = &self.buf[self.pos..end];
        self.pos = end;
        Ok(out)
    }

    fn array<const N: usize>(&mut self, field: &'static str) -> Result<[u8; N], WireError> {
        let bytes = self.take(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(bytes);
        let _ = field; // kept for future per-field truncation messages
        Ok(out)
    }

    fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.array::<1>("u8")?[0])
    }

    fn u16_le(&mut self) -> Result<u16, WireError> {
        let b = self.array::<2>("u16")?;
        Ok(u16::from_le_bytes(b))
    }

    fn u32_le(&mut self) -> Result<u32, WireError> {
        let b = self.array::<4>("u32")?;
        Ok(u32::from_le_bytes(b))
    }

    fn u64_le(&mut self) -> Result<u64, WireError> {
        let b = self.array::<8>("u64")?;
        Ok(u64::from_le_bytes(b))
    }

    /// Presence flag: 0x00 absent, 0x01 present, anything else malformed.
    fn flag(&mut self, field: &'static str) -> Result<bool, WireError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            v => Err(WireError::bad_flag(field, v)),
        }
    }

    /// Presence flag for a field that MUST be absent in v1. The byte is still
    /// consumed (the format is fixed-width), but only 0x00 is accepted. This
    /// keeps the format forward-compatible: v2 can flip the flag to carry the
    /// field without renumbering everything after it.
    fn forbidden(&mut self, field: &'static str) -> Result<(), WireError> {
        match self.u8()? {
            0 => Ok(()),
            v => Err(WireError::new(
                ERR_FIELD_UNSUPPORTED,
                format!(
                    "field `{}` must not be present in wire format v1 (flag byte {})",
                    field, v
                ),
            )),
        }
    }

    /// `optional` = one presence flag + fixed-width payload.
    fn optional<const N: usize>(
        &mut self,
        field: &'static str,
    ) -> Result<Option<[u8; N]>, WireError> {
        if self.flag(field)? {
            Ok(Some(self.array::<N>(field)?))
        } else {
            Ok(None)
        }
    }

    fn optional_u64(&mut self, field: &'static str) -> Result<Option<u64>, WireError> {
        if self.flag(field)? {
            Ok(Some(self.u64_le()?))
        } else {
            Ok(None)
        }
    }
}

/// Parses a complete request (or response) buffer.
///
/// The frame is exact-length checked: running short yields `ERR_TRUNCATED`,
/// trailing bytes after the trailer yield `ERR_EXCESS_BYTES`. A zero
/// `action_count` is rejected (`ERR_NO_ACTIONS`) — the fork's builder cannot
/// produce an empty bundle and `extract` would return `None` there.
pub fn parse_request(buf: &[u8]) -> Result<RequestWire, WireError> {
    let mut r = Reader { buf, pos: 0 };

    let version = r.u8()?;
    if version != 1 {
        return Err(WireError::new(
            ERR_VERSION,
            format!("wire version must be 1, got {}", version),
        ));
    }

    let action_count = r.u16_le()?;
    let flags = r.u8()?;
    let value_sum_magnitude = r.u64_le()?;
    let neg_byte = r.u8()?;
    let value_sum_is_negative = match neg_byte {
        0 => false,
        1 => true,
        v => return Err(WireError::bad_flag("value_sum.is_negative", v)),
    };
    let anchor = r.array::<32>("anchor")?;

    // Reject absurd counts before allocating: 65535 actions x 1845 bytes is
    // the theoretical max (~121 MB); the Worker's own memory ceiling is the
    // real limit, but the allocation here must not be driven by attacker
    // input without the exact-length check below to back it.
    if action_count == 0 {
        return Err(WireError::new(
            ERR_NO_ACTIONS,
            "action_count must be at least 1",
        ));
    }

    let mut actions = Vec::with_capacity(action_count as usize);
    for i in 0..action_count {
        actions.push(parse_action(&mut r).map_err(|e| {
            WireError::new(e.code, format!("action {}: {}", i, e.message))
        })?);
    }

    // Trailer.
    let zkproof = if r.flag("zkproof")? {
        let len = r.u32_le()? as usize;
        Some(r.take(len)?.to_vec())
    } else {
        None
    };
    r.forbidden("bsk")?;

    if r.pos != buf.len() {
        return Err(WireError::new(
            ERR_EXCESS_BYTES,
            format!(
                "frame is exact-length: consumed {} of {} bytes",
                r.pos,
                buf.len()
            ),
        ));
    }

    Ok(RequestWire {
        action_count,
        flags,
        value_sum_magnitude,
        value_sum_is_negative,
        anchor,
        actions,
        zkproof,
    })
}

fn parse_action(r: &mut Reader) -> Result<WireAction, WireError> {
    let cv_net = r.array::<32>("cv_net")?;
    let rcv = r.optional::<32>("rcv")?;
    let spend = parse_spend(r)?;
    let output = parse_output(r)?;
    Ok(WireAction {
        cv_net,
        rcv,
        spend,
        output,
    })
}

fn parse_spend(r: &mut Reader) -> Result<WireSpend, WireError> {
    let nullifier = r.array::<32>("nullifier")?;
    let rk = r.array::<32>("rk")?;
    let spend_auth_sig = r.optional::<64>("spend_auth_sig")?;
    let recipient = r.optional::<43>("spend.recipient")?;
    let value = r.optional_u64("spend.value")?;
    let rho = r.optional::<32>("spend.rho")?;
    let rseed = r.optional::<32>("spend.rseed")?;
    let fvk = r.optional::<96>("spend.fvk")?;

    let witness = if r.flag("spend.witness")? {
        let position = r.u32_le()?;
        let mut path = [[0u8; 32]; TREE_DEPTH];
        for node in path.iter_mut() {
            *node = r.array::<32>("spend.witness.path")?;
        }
        Some((position, path))
    } else {
        None
    };

    let alpha = r.optional::<32>("spend.alpha")?;

    // Forbidden in v1; the format stays fixed-width so these three bytes are
    // always consumed and only `0x00` is accepted.
    r.forbidden("spend.dummy_sk")?;
    r.forbidden("spend.zip32_derivation")?;
    r.forbidden("spend.proprietary")?;

    Ok(WireSpend {
        nullifier,
        rk,
        spend_auth_sig,
        recipient,
        value,
        rho,
        rseed,
        fvk,
        witness,
        alpha,
    })
}

fn parse_output(r: &mut Reader) -> Result<WireOutput, WireError> {
    let cmx = r.array::<32>("output.cmx")?;
    let ephemeral_key = r.array::<32>("output.ephemeral_key")?;
    let enc_ciphertext = r.array::<ENC_CIPHERTEXT_LEN>("output.enc_ciphertext")?;
    let out_ciphertext = r.array::<80>("output.out_ciphertext")?;
    let recipient = r.optional::<43>("output.recipient")?;
    let value = r.optional_u64("output.value")?;
    let rseed = r.optional::<32>("output.rseed")?;
    let ock = r.optional::<32>("output.ock")?;
    r.forbidden("output.user_address")?;
    r.forbidden("output.zip32_derivation")?;
    r.forbidden("output.proprietary")?;
    Ok(WireOutput {
        cmx,
        ephemeral_key,
        enc_ciphertext,
        out_ciphertext,
        recipient,
        value,
        rseed,
        ock,
    })
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// Growable writer; mirrors `Reader` field-for-field.
struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    fn new(capacity: usize) -> Self {
        Writer {
            buf: Vec::with_capacity(capacity),
        }
    }

    fn bytes(&mut self, b: &[u8]) {
        self.buf.extend_from_slice(b);
    }

    fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }

    fn u16_le(&mut self, v: u16) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn u32_le(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn u64_le(&mut self, v: u64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn flag(&mut self, present: bool) {
        self.u8(if present { 1 } else { 0 });
    }

    fn optional<const N: usize>(&mut self, v: &Option<[u8; N]>) {
        self.flag(v.is_some());
        if let Some(bytes) = v {
            self.bytes(bytes);
        }
    }

    fn optional_u64(&mut self, v: &Option<u64>) {
        self.flag(v.is_some());
        if let Some(n) = v {
            self.u64_le(*n);
        }
    }
}

/// Serializes a request/response. Used for the Worker's response (with
/// `zkproof` present) and by the tests to build synthetic requests.
pub fn serialize_request(req: &RequestWire) -> Vec<u8> {
    let mut w = Writer::new(req.wire_len());

    w.u8(1); // version
    w.u16_le(req.actions.len().min(u16::MAX as usize) as u16);
    w.u8(req.flags);
    w.u64_le(req.value_sum_magnitude);
    w.u8(if req.value_sum_is_negative { 1 } else { 0 });
    w.bytes(&req.anchor);

    for action in &req.actions {
        w.bytes(&action.cv_net);
        w.optional(&action.rcv);

        // Spend section.
        w.bytes(&action.spend.nullifier);
        w.bytes(&action.spend.rk);
        w.optional(&action.spend.spend_auth_sig);
        w.optional(&action.spend.recipient);
        w.optional_u64(&action.spend.value);
        w.optional(&action.spend.rho);
        w.optional(&action.spend.rseed);
        w.optional(&action.spend.fvk);
        match &action.spend.witness {
            Some((position, path)) => {
                w.flag(true);
                w.u32_le(*position);
                for node in path {
                    w.bytes(node);
                }
            }
            None => w.flag(false),
        }
        w.optional(&action.spend.alpha);
        w.forbidden_placeholder(); // dummy_sk
        w.forbidden_placeholder(); // zip32_derivation
        w.forbidden_placeholder(); // proprietary

        // Output section.
        w.bytes(&action.output.cmx);
        w.bytes(&action.output.ephemeral_key);
        w.bytes(&action.output.enc_ciphertext);
        w.bytes(&action.output.out_ciphertext);
        w.optional(&action.output.recipient);
        w.optional_u64(&action.output.value);
        w.optional(&action.output.rseed);
        w.optional(&action.output.ock);
        w.forbidden_placeholder(); // user_address
        w.forbidden_placeholder(); // zip32_derivation
        w.forbidden_placeholder(); // proprietary
    }

    // Trailer.
    match &req.zkproof {
        Some(proof) => {
            w.flag(true);
            // The length prefix is u32; proofs are bounded by the fork's
            // `Proof::expected_proof_size`, far below u32::MAX.
            w.u32_le(proof.len() as u32);
            w.bytes(proof);
        }
        None => w.flag(false),
    }
    w.forbidden_placeholder(); // bsk

    w.buf
}

impl Writer {
    fn forbidden_placeholder(&mut self) {
        self.u8(0);
    }
}

// ---------------------------------------------------------------------------
// Fork bridge: wire <-> orchard::pczt
// ---------------------------------------------------------------------------
//
// Conversion between the wire format and the pinned fork's PCZT types.
// This is the ONLY layer that touches `orchard::pczt`; the byte layer above
// stays pure `std` so it remains host-testable without instantiating the
// circuit.
//
// Trust note: `to_fork_bundle` is what the WORKER runs on client input; every
// field goes through the fork's own validating `parse` constructors, so a
// tampered field either fails a constructor (mapped 1:1 to the error codes in
// `codes`) or flows into the circuit and fails the proof.

use std::collections::BTreeMap;

use ff::PrimeField;
use orchard::memo::DashMemo;
use orchard::pczt;

/// Error message prefix for per-action context, mirroring `parse_request`'s
/// "action N: ..." convention.
fn fork_parse_error(e: pczt::ParseError) -> WireError {
    use pczt::ParseError as PE;
    let (code, msg) = match &e {
        PE::InvalidAnchor => (ERR_INVALID_ANCHOR, "invalid anchor"),
        PE::InvalidBindingSignatureSigningKey => (ERR_INVALID_BSK, "invalid `bsk`"),
        PE::InvalidDummySpendingKey => (ERR_INVALID_DUMMY_SK, "invalid `dummy_sk`"),
        PE::InvalidEncCiphertext => (ERR_INVALID_ENC_CIPHERTEXT, "invalid `enc_ciphertext`"),
        PE::InvalidExtractedNoteCommitment => (ERR_INVALID_CMX, "invalid `cmx`"),
        PE::InvalidFullViewingKey => (ERR_INVALID_FVK, "invalid `fvk`"),
        PE::InvalidNullifier => (ERR_INVALID_NULLIFIER, "invalid `nullifier`"),
        PE::InvalidOutCiphertext => (ERR_INVALID_OUT_CIPHERTEXT, "invalid `out_ciphertext`"),
        PE::InvalidRandomizedKey => (ERR_INVALID_RK, "invalid `rk`"),
        PE::InvalidRandomSeed => (ERR_INVALID_RSEED, "invalid `rseed`"),
        PE::InvalidRecipient => (ERR_INVALID_RECIPIENT, "invalid `recipient`"),
        PE::InvalidRho => (ERR_INVALID_RHO, "invalid `rho`"),
        PE::InvalidSpendAuthRandomizer => (ERR_INVALID_ALPHA, "invalid `alpha`"),
        PE::InvalidValueCommitment => (ERR_INVALID_CV_NET, "invalid `cv_net`"),
        PE::InvalidValueCommitTrapdoor => (ERR_INVALID_RCV, "invalid `rcv`"),
        PE::InvalidWitness => (ERR_INVALID_WITNESS, "invalid witness node"),
        PE::InvalidZip32Derivation => (ERR_INVALID_ZIP32, "invalid `zip32_derivation`"),
        PE::MissingRho => (
            ERR_MISSING_RHO,
            "`rho` must be provided whenever `rseed` is provided",
        ),
        PE::UnexpectedFlagBitsSet => (ERR_BAD_FLAGS, "`flags` field had unexpected bits set"),
        // `ParseError` is #[non_exhaustive]; the fork is pinned (git tag
        // `dashified-0.14.1`), so this arm should be unreachable. It exists so
        // a fork bump that adds a variant fails loudly instead of being
        // silently collapsed into an unrelated code.
        _ => (
            ERR_UNEXPECTED_FORK_ERROR,
            "unrecognized pczt::ParseError variant (fork drift?)",
        ),
    };
    WireError::new(code, format!("{} ({:?})", msg, e))
}

fn fork_prover_error(e: pczt::ProverError) -> WireError {
    use pczt::ProverError as PE;
    let (code, msg) = match &e {
        PE::InvalidOutputNote => (
            ERR_PROVER_INVALID_OUTPUT_NOTE,
            "output note's components do not produce a valid note commitment",
        ),
        PE::InvalidSpendNote => (
            ERR_PROVER_INVALID_SPEND_NOTE,
            "spent note's components do not produce a valid note commitment",
        ),
        PE::MissingFullViewingKey => (ERR_PROVER_MISSING_FVK, "prover requires `fvk` to be set"),
        PE::MissingRandomSeed => (ERR_PROVER_MISSING_RSEED, "prover requires `rseed` to be set"),
        PE::MissingRecipient => {
            (ERR_PROVER_MISSING_RECIPIENT, "prover requires `recipient` to be set")
        }
        PE::MissingRho => (ERR_PROVER_MISSING_RHO, "prover requires `rho` to be set"),
        PE::MissingSpendAuthRandomizer => {
            (ERR_PROVER_MISSING_ALPHA, "prover requires `alpha` to be set")
        }
        PE::MissingValue => (ERR_PROVER_MISSING_VALUE, "prover requires `value` to be set"),
        PE::MissingValueCommitTrapdoor => {
            (ERR_PROVER_MISSING_RCV, "prover requires `rcv` to be set")
        }
        PE::MissingWitness => (ERR_PROVER_MISSING_WITNESS, "prover requires `witness` to be set"),
        PE::ProofFailed(_) => (ERR_PROVER_FAILED, "Halo 2 proof failed (detail in Debug of the error)"),
        PE::RhoMismatch => (
            ERR_PROVER_RHO_MISMATCH,
            "output note's rho does not equal the spent note's nullifier",
        ),
        PE::IdentityRk => (
            ERR_PROVER_IDENTITY_RK,
            "action has an identity rk (forbidden by consensus)",
        ),
        PE::WrongFvkForNote => (
            ERR_PROVER_WRONG_FVK,
            "the provided fvk does not own the spent note",
        ),
        // See fork_parse_error: pinned fork, unreachable in practice.
        _ => (
            ERR_UNEXPECTED_FORK_ERROR,
            "unrecognized pczt::ProverError variant (fork drift?)",
        ),
    };
    WireError::new(code, msg)
}

/// Builds a fork PCZT bundle from parsed wire data.
///
/// Every field is validated by the fork's own `parse` constructors; a failure
/// maps 1:1 to the `codes` table. `bsk` is always `None` (forbidden in v1:
/// the IO Finalizer runs client-side) and `zkproof` is whatever the wire
/// carried (absent on a prove request, present on a re-parse of a response).
pub fn to_fork_bundle(req: &RequestWire) -> Result<pczt::Bundle<DashMemo>, WireError> {
    let mut actions = Vec::with_capacity(req.actions.len());
    for (i, wa) in req.actions.iter().enumerate() {
        let action =
            to_fork_action(wa).map_err(|e| WireError::new(e.code, format!("action {}: {}", i, e.message)))?;
        actions.push(action);
    }
    pczt::Bundle::parse(
        actions,
        req.flags,
        (req.value_sum_magnitude, req.value_sum_is_negative),
        req.anchor,
        req.zkproof.clone(),
        None, // bsk: forbidden in v1
    )
    .map_err(fork_parse_error)
}

fn to_fork_action(wa: &WireAction) -> Result<pczt::Action<DashMemo>, WireError> {
    // The spend nullifier is parsed once here so `Output::parse` can use it
    // (the fork derives the output note's rho from the spent note's
    // nullifier); `Spend::parse` re-validates its own copy.
    let nullifier = orchard::note::Nullifier::from_bytes(&wa.spend.nullifier)
        .into_option()
        .ok_or_else(|| {
            WireError::new(
                ERR_INVALID_NULLIFIER,
                "spend.nullifier is not a valid pallas::Base value",
            )
        })?;

    let spend = pczt::Spend::parse(
        wa.spend.nullifier,
        wa.spend.rk,
        wa.spend.spend_auth_sig,
        wa.spend.recipient,
        wa.spend.value,
        wa.spend.rho,
        wa.spend.rseed,
        wa.spend.fvk,
        wa.spend.witness,
        wa.spend.alpha,
        None, // zip32_derivation: forbidden in v1 (mandatory-zero wire flag)
        None, // dummy_sk: forbidden in v1; the client's io_finalizer clears it
        //        before serialization, so no client ever needs to send it
        BTreeMap::new(), // proprietary: forbidden in v1
    )
    .map_err(fork_parse_error)?;

    let output = pczt::Output::parse(
        nullifier,
        wa.output.cmx,
        wa.output.ephemeral_key,
        wa.output.enc_ciphertext.to_vec(),
        wa.output.out_ciphertext.to_vec(),
        wa.output.recipient,
        wa.output.value,
        wa.output.rseed,
        wa.output.ock,
        None, // zip32_derivation: forbidden in v1
        None, // user_address: forbidden in v1
        BTreeMap::new(), // proprietary: forbidden in v1
    )
    .map_err(fork_parse_error)?;

    pczt::Action::parse(wa.cv_net, spend, output, wa.rcv).map_err(fork_parse_error)
}

/// Runs the Prover role on a fork PCZT bundle and returns the proof bytes.
///
/// `pk` MUST come from `ProvingKey::build` (the crate's cached proving key):
/// the PCZT circuits are built for `OrchardCircuitVersion::FixedPostNu6_2`
/// (`circuit.rs:191-203`) and `Proof::create` rejects a version mismatch
/// (`circuit.rs:1030-1036`), which `ProvingKey::build` matches
/// (`circuit.rs:859-862`).
///
/// This takes `&mut` and a `&ProvingKey` from `crate::proving_key()`; the
/// caller (the `prove_pczt` export) does the timing and error capture.
pub fn prove_in_fork(
    bundle: &mut pczt::Bundle<DashMemo>,
    pk: &orchard::circuit::ProvingKey,
    rng: impl rand_core::RngCore + rand_core::CryptoRng,
) -> Result<Vec<u8>, WireError> {
    bundle
        .create_proof(pk, rng)
        .map_err(fork_prover_error)?;
    match bundle.zkproof().as_ref() {
        Some(proof) => Ok(proof.as_ref().to_vec()),
        None => Err(WireError::new(
            ERR_PROVER_FAILED,
            "create_proof returned Ok without setting zkproof",
        )),
    }
}

/// Serializes a fork PCZT bundle into the wire format.
///
/// This is the CLIENT-side direction (browser: `build_for_pczt` -> sign ->
/// `finalize_io` -> this). It reads only the fork's public getters, so it is
/// usable verbatim in the browser build of this crate. By the time a client
/// serializes, `io_finalizer` has already run (all `spend_auth_sig`s present,
/// `dummy_sk` cleared), which is exactly what the v1 wire format assumes:
/// `dummy_sk` has no field here and no signature may be missing.
///
/// Note: `zip32_derivation` / `user_address` / `proprietary` are dropped, not
/// rejected — they are unused by every role this protocol runs and the wire
/// format carries no field for them.
pub fn pczt_to_wire(bundle: &pczt::Bundle<DashMemo>) -> Result<RequestWire, WireError> {
    let mut actions = Vec::with_capacity(bundle.actions().len());
    for action in bundle.actions() {
        let spend = action.spend();
        let output = action.output();

        // Auth path, leaf-to-root per `MerklePath::root`'s indexing
        // (`tree.rs:147-160`: `auth_path[0]` combines at `l = 0`, the leaf
        // layer). Preserved verbatim; the fork re-interprets it identically
        // on parse-back.
        let witness = spend.witness().as_ref().map(|p| {
            let mut path = [[0u8; 32]; TREE_DEPTH];
            for (dst, node) in path.iter_mut().zip(p.auth_path().iter()) {
                *dst = node.to_bytes();
            }
            (p.position(), path)
        });

        // `epk_bytes`/`enc_ciphertext`/`out_ciphertext` are the same
        // `TransmittedNoteCiphertext` fields the shield path already
        // serializes (`src/lib.rs` build_inner); 216 bytes = epk(32) +
        // enc(104) + out(80) for DashMemo.
        let enc = output.encrypted_note();
        let mut ephemeral_key = [0u8; 32];
        ephemeral_key.copy_from_slice(&enc.epk_bytes);
        let mut enc_ciphertext = [0u8; ENC_CIPHERTEXT_LEN];
        enc_ciphertext.copy_from_slice(AsRef::<[u8]>::as_ref(&enc.enc_ciphertext));
        let mut out_ciphertext = [0u8; 80];
        out_ciphertext.copy_from_slice(&enc.out_ciphertext);

        actions.push(WireAction {
            cv_net: action.cv_net().to_bytes(),
            rcv: action.rcv().as_ref().map(|t| t.to_bytes()),
            spend: WireSpend {
                nullifier: spend.nullifier().to_bytes(),
                // `From<&redpallas::VerificationKey>` for `[u8; 32]` and
                // `From<&redpallas::Signature>` for `[u8; 64]` are the same
                // conversions the shield path uses in `lib.rs`.
                rk: <[u8; 32]>::from(spend.rk()),
                spend_auth_sig: spend
                    .spend_auth_sig()
                    .as_ref()
                    .map(|s| <[u8; 64]>::from(s)),
                recipient: spend
                    .recipient()
                    .as_ref()
                    .map(|addr| addr.to_raw_address_bytes()),
                value: spend.value().as_ref().map(|v| v.inner()),
                rho: spend.rho().as_ref().map(|r| r.to_bytes()),
                rseed: spend.rseed().as_ref().map(|s| *s.as_bytes()),
                fvk: spend.fvk().as_ref().map(|f| f.to_bytes()),
                witness,
                alpha: spend.alpha().as_ref().map(|s| s.to_repr()),
            },
            output: WireOutput {
                cmx: output.cmx().to_bytes(),
                ephemeral_key,
                enc_ciphertext,
                out_ciphertext,
                recipient: output
                    .recipient()
                    .as_ref()
                    .map(|addr| addr.to_raw_address_bytes()),
                value: output.value().as_ref().map(|v| v.inner()),
                rseed: output.rseed().as_ref().map(|s| *s.as_bytes()),
                ock: output.ock().as_ref().map(|k| k.0),
            },
        });
    }

    let (magnitude, sign) = bundle.value_sum().magnitude_sign();
    Ok(RequestWire {
        action_count: bundle.actions().len() as u16,
        flags: bundle.flags().to_byte(),
        value_sum_magnitude: magnitude,
        value_sum_is_negative: matches!(sign, orchard::value::Sign::Negative),
        anchor: bundle.anchor().to_bytes(),
        actions,
        zkproof: bundle.zkproof().as_ref().map(|p| p.as_ref().to_vec()),
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic filler byte for synthetic fields, so a round-trip test
    /// would catch any field-order mistake between reader and writer.
    fn filler(byte: u8, len: usize) -> Vec<u8> {
        (0..len).map(|i| byte.wrapping_add(i as u8)).collect()
    }

    fn assert_eq_array<const N: usize>(a: &[u8], b: &[u8; N]) {
        assert_eq!(a.len(), N);
        assert_eq!(a, b);
    }

    fn sample_action(seed: u8, full: bool) -> WireAction {
        let mut cv_net = [0u8; 32];
        cv_net.copy_from_slice(&filler(seed, 32));

        let mut spend = WireSpend {
            nullifier: [0; 32],
            rk: [0; 32],
            spend_auth_sig: None,
            recipient: None,
            value: None,
            rho: None,
            rseed: None,
            fvk: None,
            witness: None,
            alpha: None,
        };
        spend.nullifier.copy_from_slice(&filler(seed + 1, 32));
        spend.rk.copy_from_slice(&filler(seed + 2, 32));
        let mut path = [[0u8; 32]; TREE_DEPTH];
        for (i, node) in path.iter_mut().enumerate() {
            node.copy_from_slice(&filler(seed + 3 + i as u8, 32));
        }
        if full {
            let mut sig = [0u8; 64];
            sig.copy_from_slice(&filler(seed + 4, 64));
            let mut recip = [0u8; 43];
            recip.copy_from_slice(&filler(seed + 5, 43));
            let mut rho = [0u8; 32];
            rho.copy_from_slice(&filler(seed + 6, 32));
            let mut rseed = [0u8; 32];
            rseed.copy_from_slice(&filler(seed + 7, 32));
            let mut fvk = [0u8; 96];
            fvk.copy_from_slice(&filler(seed + 8, 96));
            let mut alpha = [0u8; 32];
            alpha.copy_from_slice(&filler(seed + 9, 32));
            spend.spend_auth_sig = Some(sig);
            spend.recipient = Some(recip);
            spend.value = Some(0x0102_0304_0506_0708);
            spend.rho = Some(rho);
            spend.rseed = Some(rseed);
            spend.fvk = Some(fvk);
            spend.witness = Some((0x1122_3344, path));
            spend.alpha = Some(alpha);
        } else {
            spend.witness = Some((7, path));
        }

        let mut output = WireOutput {
            cmx: [0; 32],
            ephemeral_key: [0; 32],
            enc_ciphertext: [0; ENC_CIPHERTEXT_LEN],
            out_ciphertext: [0; 80],
            recipient: None,
            value: None,
            rseed: None,
            ock: None,
        };
        output.cmx.copy_from_slice(&filler(seed + 20, 32));
        output.ephemeral_key.copy_from_slice(&filler(seed + 21, 32));
        output.enc_ciphertext.copy_from_slice(&filler(seed + 22, ENC_CIPHERTEXT_LEN));
        output.out_ciphertext.copy_from_slice(&filler(seed + 23, 80));
        if full {
            let mut recip = [0u8; 43];
            recip.copy_from_slice(&filler(seed + 24, 43));
            let mut rseed = [0u8; 32];
            rseed.copy_from_slice(&filler(seed + 25, 32));
            let mut ock = [0u8; 32];
            ock.copy_from_slice(&filler(seed + 26, 32));
            output.recipient = Some(recip);
            output.value = Some(0x0908_0706_0504_0302);
            output.rseed = Some(rseed);
            output.ock = Some(ock);
        }

        let mut rcv = [0u8; 32];
        rcv.copy_from_slice(&filler(seed + 30, 32));
        WireAction {
            cv_net,
            rcv: Some(rcv),
            spend,
            output,
        }
    }

    fn sample_request(actions: usize, full: bool, zkproof: Option<Vec<u8>>) -> RequestWire {
        let mut anchor = [0u8; 32];
        anchor.copy_from_slice(&filler(0xEE, 32));
        RequestWire {
            action_count: actions as u16,
            flags: 0x03,
            value_sum_magnitude: 0xDEAD_BEEF_CAFE_1234,
            value_sum_is_negative: true,
            anchor,
            actions: (0..actions)
                .map(|i| sample_action((i as u8).wrapping_mul(10), full))
                .collect(),
            zkproof,
        }
    }

    #[test]
    fn geometry_matches_spec() {
        assert_eq!(HEADER_LEN, 45);
        assert_eq!(SPEND_SECTION_LEN, 1410);
        assert_eq!(OUTPUT_SECTION_LEN, 370);
        assert_eq!(ACTION_WIRE_LEN, 1845);
        // Doc example: 1 real spend + 1 dummy = 2 actions -> 3,737 bytes.
        assert_eq!(45 + 2 * ACTION_WIRE_LEN + 2, 3737);
    }

    #[test]
    fn wire_len_matches_serialized_length() {
        for &n in &[1usize, 2, 3] {
            let req = sample_request(n, true, None);
            assert_eq!(serialize_request(&req).len(), req.wire_len());
        }
    }

    #[test]
    fn round_trip_full() {
        let req = sample_request(2, true, None);
        let bytes = serialize_request(&req);
        assert_eq!(bytes.len(), 3737); // 45 + 2*1845 + 2
        let parsed = parse_request(&bytes).expect("parse");
        assert_eq!(parsed, req);
    }

    #[test]
    fn round_trip_minimal_optionals_absent() {
        let mut req = sample_request(2, false, None);
        // Strip every optional payload: flags remain (absent), witness stays
        // absent, zkproof absent.
        for a in req.actions.iter_mut() {
            a.rcv = None;
            a.spend.spend_auth_sig = None;
            a.spend.recipient = None;
            a.spend.value = None;
            a.spend.rho = None;
            a.spend.rseed = None;
            a.spend.fvk = None;
            a.spend.alpha = None;
            a.output.recipient = None;
            a.output.value = None;
            a.output.rseed = None;
            a.output.ock = None;
        }
        let bytes = serialize_request(&req);
        let parsed = parse_request(&bytes).expect("parse");
        assert_eq!(parsed, req);
    }

    #[test]
    fn round_trip_with_proof() {
        let req = sample_request(1, true, Some(filler(0x77, 7264)));
        let bytes = serialize_request(&req);
        assert_eq!(bytes.len(), req.wire_len());
        let parsed = parse_request(&bytes).expect("parse");
        assert_eq!(parsed, req);
        assert_eq!(parsed.zkproof.as_ref().unwrap().len(), 7264);
    }

    #[test]
    fn rejects_wrong_version() {
        let mut bytes = serialize_request(&sample_request(1, false, None));
        bytes[0] = 2;
        let err = parse_request(&bytes).unwrap_err();
        assert_eq!(err.code, ERR_VERSION);
        assert_eq!(err.message, "wire version must be 1, got 2");
    }

    #[test]
    fn rejects_zero_actions() {
        let mut req = sample_request(1, false, None);
        req.actions.clear();
        req.action_count = 0;
        // Serialize would still emit the header count; bypass serialize's
        // clamp by building a header with count 0 directly.
        let mut bytes = Vec::new();
        bytes.push(1); // version
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.push(3); // flags
        bytes.extend_from_slice(&1u64.to_le_bytes());
        bytes.push(0); // is_negative
        bytes.extend_from_slice(&[0u8; 32]); // anchor
        bytes.push(0); // zkproof flag
        bytes.push(0); // bsk flag
        let err = parse_request(&bytes).unwrap_err();
        assert_eq!(err.code, ERR_NO_ACTIONS);
        let _ = &mut req; // req built only to document the zero-case shape
    }

    #[test]
    fn rejects_truncation_at_every_length() {
        let full = serialize_request(&sample_request(2, true, None));
        for len in 0..full.len() {
            let err = parse_request(&full[..len]).unwrap_err();
            assert_eq!(
                err.code,
                ERR_TRUNCATED,
                "length {} should be truncated, got {:?}",
                len,
                err
            );
        }
        // And the full buffer parses.
        assert!(parse_request(&full).is_ok());
    }

    #[test]
    fn rejects_excess_bytes() {
        let mut bytes = serialize_request(&sample_request(1, false, None));
        bytes.push(0);
        let err = parse_request(&bytes).unwrap_err();
        assert_eq!(err.code, ERR_EXCESS_BYTES);
    }

    #[test]
    fn rejects_bad_presence_flag_bytes() {
        // Flip one presence flag (first rcv flag, right after cv_net) to 2.
        let mut bytes = serialize_request(&sample_request(1, false, None));
        let rcv_flag_offset = HEADER_LEN + 32;
        bytes[rcv_flag_offset] = 2;
        let err = parse_request(&bytes).unwrap_err();
        assert_eq!(err.code, ERR_BAD_FLAG_BYTE);
        assert!(err.message.contains("rcv"), "message: {}", err.message);
    }

    #[test]
    fn rejects_bad_is_negative_byte() {
        let mut bytes = serialize_request(&sample_request(1, false, None));
        bytes[12] = 5; // value_sum.is_negative offset
        let err = parse_request(&bytes).unwrap_err();
        assert_eq!(err.code, ERR_BAD_FLAG_BYTE);
        assert!(err.message.contains("is_negative"), "message: {}", err.message);
    }

    /// Offsets of the seven forbidden flag bytes in a MAXIMAL 1-action frame
    /// (all optional fields present, no zkproof). Computed from the same
    /// section constants the serializer uses, never hand-counted.
    fn forbidden_offsets_full() -> Vec<(usize, &'static str)> {
        // action starts at HEADER_LEN; cv_net(32) + rcv flag(1) + rcv(32).
        let spend_start = HEADER_LEN + 32 + 33;
        // Walk the maximal spend section in field order.
        let after_nullifier_rk = spend_start + 32 + 32;
        let after_sig = after_nullifier_rk + (1 + 64);
        let after_recipient = after_sig + (1 + 43);
        let after_value = after_recipient + (1 + 8);
        let after_rho = after_value + (1 + 32);
        let after_rseed = after_rho + (1 + 32);
        let after_fvk = after_rseed + (1 + 96);
        let after_witness = after_fvk + (1 + 4 + 32 * 32);
        let after_alpha = after_witness + (1 + 32);
        let dummy = after_alpha;
        // Output section starts right after the maximal spend section.
        let out_start = spend_start + SPEND_SECTION_LEN;
        let after_out_fixed = out_start + 32 + 32 + 104 + 80;
        let after_out_recipient = after_out_fixed + (1 + 43);
        let after_out_value = after_out_recipient + (1 + 8);
        let after_out_rseed = after_out_value + (1 + 32);
        let after_out_ock = after_out_rseed + (1 + 32);
        let user = after_out_ock;
        // Trailer: zkproof flag + bsk flag (zkproof absent here).
        let total = HEADER_LEN + ACTION_WIRE_LEN + 2;
        vec![
            (dummy, "spend.dummy_sk"),
            (dummy + 1, "spend.zip32_derivation"),
            (dummy + 2, "spend.proprietary"),
            (user, "output.user_address"),
            (user + 1, "output.zip32_derivation"),
            (user + 2, "output.proprietary"),
            (total - 1, "bsk"),
        ]
    }

    #[test]
    fn rejects_each_forbidden_field() {
        let base = serialize_request(&sample_request(1, true, None));
        for (offset, name) in forbidden_offsets_full() {
            let mut bytes = base.clone();
            bytes[offset] = 1;
            let err = parse_request(&bytes).unwrap_err();
            assert_eq!(
                err.code,
                ERR_FIELD_UNSUPPORTED,
                "field {} at offset {}",
                name,
                offset
            );
            assert!(
                err.message.contains(name),
                "message `{}` should name {}",
                err.message,
                name
            );
        }
    }

    #[test]
    fn zkproof_length_prefix_is_u32_and_respected() {
        // A zkproof whose length claims more than the remaining buffer must be
        // a truncation error, not a panic.
        let mut bytes = serialize_request(&sample_request(1, false, None));
        let zkproof_flag_offset = bytes.len() - 2;
        bytes[zkproof_flag_offset] = 1;
        bytes.extend_from_slice(&u32::MAX.to_le_bytes()); // claims 4 GB
        let err = parse_request(&bytes).unwrap_err();
        assert_eq!(err.code, ERR_TRUNCATED);
    }

    #[test]
    fn header_fields_round_trip() {
        let req = sample_request(1, false, None);
        let bytes = serialize_request(&req);
        let parsed = parse_request(&bytes).unwrap();
        assert_eq!(parsed.flags, 0x03);
        assert_eq!(parsed.value_sum_magnitude, 0xDEAD_BEEF_CAFE_1234);
        assert!(parsed.value_sum_is_negative);
        assert_eq_array(&bytes[13..45], &parsed.anchor);
        assert_eq!(parsed.action_count, 1);
        assert_eq!(parsed.actions.len(), 1);
    }

    #[test]
    fn witness_position_round_trips() {
        let req = sample_request(1, false, None);
        let bytes = serialize_request(&req);
        let parsed = parse_request(&bytes).unwrap();
        let (position, path) = parsed.actions[0].spend.witness.as_ref().unwrap();
        assert_eq!(*position, 7);
        assert_eq!(path.len(), TREE_DEPTH);
        assert_eq_array(&filler(3, 32), &path[0]);
        assert_eq_array(&filler(3 + (TREE_DEPTH as u8 - 1), 32), &path[TREE_DEPTH - 1]);
    }

    #[test]
    fn value_fields_survive_bigint_boundary() {
        // u64 max: the JS caller passes BigInt; the wire must not lose bits.
        let mut req = sample_request(1, false, None);
        req.actions[0].spend.value = Some(u64::MAX);
        req.value_sum_magnitude = u64::MAX;
        let parsed = parse_request(&serialize_request(&req)).unwrap();
        assert_eq!(parsed.actions[0].spend.value, Some(u64::MAX));
        assert_eq!(parsed.value_sum_magnitude, u64::MAX);
    }

    // -------------------------------------------------------------------------
    // Fork round-trip: the full protocol, natively
    // -------------------------------------------------------------------------
    //
    // This is the acceptance test for the wire format:
    //
    //   1. CLIENT: build a real spend PCZT (`build_for_pczt`), sign the real
    //      spends (`Action::sign`) and the dummies (`finalize_io`), serialize
    //      to wire via `pczt_to_wire`.
    //   2. SERVER: parse wire -> `to_fork_bundle` -> `prove_in_fork`.
    //   3. CLIENT: re-parse the response -> `to_fork_bundle` -> extract ->
    //      apply_binding_signature -> a fully authorized bundle whose
    //      commitment EQUALS the commitment computed before proving.
    //
    // Any byte drift between `pczt_to_wire` and the parse-back path breaks the
    // final commitment equality, so this catches field-order, width, and
    // encoding mistakes all at once.
    //
    // It pays `ProvingKey::build()` (~minutes, K=11); the key is cached for the
    // whole test binary.
    #[test]
    fn fork_round_trip_prove_and_finalize() {
        use orchard::builder::{Builder, BundleType};
        use orchard::keys::{FullViewingKey, Scope, SpendAuthorizingKey, SpendingKey};
        use orchard::memo::DashMemo;
        use orchard::note::{ExtractedNoteCommitment, Note, RandomSeed, Rho};
        use orchard::tree::{Anchor, MerkleHashOrchard, MerklePath};
        use orchard::value::NoteValue;
        use incrementalmerkletree::Hashable as _;
        use std::sync::OnceLock;

        use crate::OsRngShim;

        static PK: OnceLock<orchard::circuit::ProvingKey> = OnceLock::new();
        let pk = PK.get_or_init(orchard::circuit::ProvingKey::build);

        // --- CLIENT: spendable note, same construction as rs-dpp's own test
        // helpers (platform/.../builder/mod.rs:421-436): fixed key, zero rho,
        // rseed [1;32].
        let sk = Option::<SpendingKey>::from(SpendingKey::from_bytes([42u8; 32]))
            .expect("valid spending key bytes");
        let fvk = FullViewingKey::from(&sk);
        let ask = SpendAuthorizingKey::from(&sk);
        let payment_address = fvk.address_at(0u32, Scope::External);

        let rho = Option::<Rho>::from(Rho::from_bytes(&[0u8; 32]))
            .expect("zero is a valid pallas::Base");
        let rseed = Option::<RandomSeed>::from(RandomSeed::from_bytes([1u8; 32], &rho))
            .expect("valid random seed");
        let note = Option::<Note>::from(Note::from_parts(
            payment_address,
            NoteValue::from_raw(50_000),
            rho,
            rseed,
        ))
        .expect("note commitment should be valid");

        // All-zeros auth path at position 0; the anchor MUST be the root this
        // path actually produces for this note (the circuit checks
        // anchor == path.root(cmx)), so derive it rather than guessing.
        let auth_path = [MerkleHashOrchard::empty_leaf(); TREE_DEPTH];
        let merkle_path = MerklePath::from_parts(0, auth_path);
        let anchor: Anchor = merkle_path
            .root(ExtractedNoteCommitment::from(note.commitment()));

        // --- CLIENT: build the PCZT (1 real spend + 1 self-change output;
        // BundleType::DEFAULT pads only unbalanced bundles).
        let mut builder = Builder::<DashMemo>::new(BundleType::DEFAULT, anchor);
        builder
            .add_spend(fvk.clone(), note.clone(), merkle_path.clone())
            .expect("add_spend");
        builder
            .add_output(
                Some(fvk.to_ovk(Scope::External)),
                payment_address,
                NoteValue::from_raw(10_000),
                [0u8; 36],
            )
            .expect("add_output");
        let (mut pczt_bundle, _meta) = builder
            .build_for_pczt(OsRngShim)
            .expect("build_for_pczt");

        // --- CLIENT: commitment -> sighash -> sign real spends -> finalize_io
        // (signs dummies, sets bsk, clears dummy_sk). All BEFORE the wire —
        // this is why the wire format needs no dummy_sk field.
        let effects_bundle = pczt_bundle
            .extract_effects::<i64>()
            .expect("extract_effects")
            .expect("bundle should not be empty");
        let commitment: [u8; 32] = effects_bundle.commitment().into();
        let sighash = crate::compute_platform_sighash(&commitment, &[]);

        let mut rng = OsRngShim;
        for action in pczt_bundle.actions_mut() {
            // Real spends succeed; any dummy action (none in this build) fails
            // with WrongSpendAuthorizingKey and is left for finalize_io.
            let _ = action.sign(sighash, &ask, &mut rng);
        }
        pczt_bundle.finalize_io(sighash, &mut rng).expect("finalize_io");

        // --- CLIENT: serialize to wire. Every action MUST now carry a
        // signature and rcv (the wire format has no field for anything the
        // client hasn't already done).
        let sent = pczt_to_wire(&pczt_bundle).expect("pczt_to_wire");
        for a in &sent.actions {
            assert!(a.spend.spend_auth_sig.is_some(), "unsigned action in wire");
            assert!(a.rcv.is_some(), "missing rcv in wire");
        }
        let sent_bytes = serialize_request(&sent);

        // Wire round trip: parse(serialize(x)) == x, byte-exact.
        let parsed = parse_request(&sent_bytes).expect("parse_request");
        assert_eq!(serialize_request(&parsed), sent_bytes);
        // The commitment must survive the wire byte-for-byte.
        let parsed_effects = to_fork_bundle(&parsed)
            .expect("to_fork_bundle (pre-proof)")
            .extract_effects::<i64>()
            .expect("extract_effects (parsed)")
            .expect("bundle should not be empty");
        let parsed_commitment: [u8; 32] = parsed_effects.commitment().into();
        assert_eq!(parsed_commitment, commitment, "commitment drifted over the wire");

        // --- SERVER: prove.
        let mut server_bundle = to_fork_bundle(&parsed).expect("to_fork_bundle (server)");
        let proof = prove_in_fork(&mut server_bundle, pk, OsRngShim).expect("prove");
        // Canonical proof size, per the fork's own formula — the same check
        // `tx_extractor::extract` and consensus's `ProofSizeEnforcement::Strict`
        // apply.
        assert_eq!(
            proof.len(),
            orchard::Proof::expected_proof_size(parsed.actions.len()),
            "proof size is not canonical"
        );

        // --- CLIENT: response -> finalize -> authorized bundle.
        let mut response = parsed.clone();
        response.zkproof = Some(proof);
        let response_bytes = serialize_request(&response);
        let parsed_response = parse_request(&response_bytes).expect("parse response");
        let mut client_bundle = to_fork_bundle(&parsed_response).expect("to_fork_bundle (client)");
        // `bsk` does not ride the wire (forbidden in v1) because it is fully
        // derivable from the `rcv` values that DO ride the wire: re-running
        // `finalize_io` recomputes it deterministically. There is nothing left
        // to sign here (`dummy_sk` was cleared by the pre-send `finalize_io`,
        // so every signature already rides the wire).
        client_bundle
            .finalize_io(sighash, &mut OsRngShim)
            .expect("finalize_io (bsk re-derivation)");
        let unbound = client_bundle
            .extract::<i64>()
            .expect("extract")
            .expect("bundle should not be empty");
        let authorized = unbound
            .apply_binding_signature(sighash, &mut OsRngShim)
            .expect("apply_binding_signature");

        // The authorized bundle's commitment must equal the commitment the
        // signatures were made over — this is what consensus re-derives.
        let authorized_commitment: [u8; 32] = authorized.commitment().into();
        assert_eq!(authorized_commitment, commitment);
    }
}
