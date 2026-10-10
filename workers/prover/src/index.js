// src/index.js
//
// Sansbank DAO Shielded Prover Worker
//
// Generates the Halo 2 Orchard proof needed by `ShieldFromAssetLock` (L1 Dash
// Core asset lock -> L2 Dash Platform shielded pool).
//
// This service is DAO-wide. It serves every Sansbank product and is deployed at
// `https://prover.sansbank.dev`. It was extracted from `dashpoint-api/apps/prover`
// and the old `dashpoint-prover` Worker was retired.
//
// TRUST MODEL
// -----------
// The server holds the Halo 2 proving key and NOTHING else. The proving key is a
// public parameter: it is deterministic in the circuit shape
// (`Params::new(K)` + `keygen_pk`, K = 11;
// orchard/src/circuit.rs:75 and :886) and reveals nothing about a note, a
// spending key, or a value. Every input below is already public on-chain data.
//
// The browser keeps the asset-lock private key, assembles the final transition,
// and broadcasts it. This Worker never signs a transition, never touches a
// spending key, and never reaches the network.
//
// VERIFICATION
// ------------
// The bundle this Worker returns has been verified through the SAME code path
// consensus runs (`Bundle::try_from_parts(.., ProofSizeEnforcement::Strict)` +
// `BatchValidator::validate`);
// see rs-drive-abci/.../shielded_common/mod.rs:194-238. That verification
// PASSES, including the binding signature, which is why the platform sighash
// below is computed rather than stubbed.
//
// WHY THE SIGHASH IS COMPUTED HERE
// --------------------------------
// `apply_signatures` receives the platform sighash
// `SHA-256("DashPlatformSighash" || bundle_commitment || extra_data)`
// (`platform/packages/rs-dpp/src/shielded/sighash.rs:35`). For the shield path
// `extra_data` is empty. Passing a zero sighash produces a binding signature
// that verifies nowhere; the Rust crate computes it correctly and this Worker
// passes the result through untouched.

// The wasm is a STATIC import so `workerd` links it at deploy time. Calling
// `WebAssembly.compile()` at runtime is disallowed in workerd, and a
// `wasm-bindgen` module would emit imports that cannot be satisfied here. This
// module has ZERO imports and instantiates with `{}`.
import wasmModule from "./orchard.wasm";

let instance = null;
let instanceInitMs = null;

// Diagnostics for the one question that decides the deployment shape: does
// Cloudflare reuse this isolate between requests? If it does, the Halo 2
// proving key (built once into a `OnceLock` inside the wasm, ~30-50 s) stays
// warm and later requests only pay for the proof. If it does not, every request
// repays keygen. Two responses carrying the same id came from the same isolate.
//
// MEASURED CONSTRAINT: `crypto.randomUUID()` MUST NOT be called in global
// scope. workerd rejects the whole deploy with error 10021 ("Disallowed
// operation called within global scope ... generating random values are not
// allowed within global scope"). It is therefore derived lazily, on first use
// inside a handler, from the module-evaluation timestamp plus a counter -- no
// randomness needed, since this is a diagnostic label and not a security value.
let ISOLATE_ID = null;
let requestCount = 0;
function isolateId() {
  if (ISOLATE_ID === null) {
    ISOLATE_ID = `iso-${Date.now().toString(36)}`;
  }
  return ISOLATE_ID;
}

function getExports() {
  if (instance === null) {
    const t0 = Date.now();
    instance = new WebAssembly.Instance(wasmModule, {});
    instanceInitMs = Date.now() - t0;
  }
  return instance.exports;
}

/** Reads the crate's captured error message, set when a call returns 0. */
function readError(exports) {
  const len = exports.err_len();
  if (len === 0) return "(no error message captured in wasm)";
  const ptr = exports.err_ptr();
  return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
}

/**
 * Copies bytes into the wasm heap and returns the offset. The scratch region is
 * above 65536 so it cannot collide with the Rust stack/heap during startup.
 */
function writeBytes(exports, bytes, offset) {
  new Uint8Array(exports.memory.buffer, offset, bytes.length).set(bytes);
  return offset;
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(b)) return null;
    out[i] = b;
  }
  return out;
}

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}

const SCRATCH_RECIPIENT = 1 << 20; // 1 MiB
const SCRATCH_MEMO = (1 << 20) + 1024;
const SCRATCH_PCZT = (1 << 20) + 2048;

/**
 * POST /prove/shield
 *
 * Body (all public):
 *   { "recipient": "<86-hex-char = 43-byte raw Orchard address>",
 *     "amount": "100000",        // decimal string or number, duffs
 *     "memo": "<72-hex-char = 36 bytes, optional>",
 *     "dummyOutputs": 0 }        // optional, enlarges the anonymity set
 *
 * Response: the bundle the browser needs to build the transition.
 */
async function handleShield(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // The recipient is the 43 RAW bytes (11 diversifier || 32 pk_d), not the
  // bech32m string. Decoding bech32m here would duplicate logic the browser and
  // rs-dpp already own, and the raw form is what the circuit consumes.
  const recipient = hexToBytes(body.recipient);
  if (!recipient || recipient.length !== 43) {
    return json(
      { error: "recipient must be 43 raw bytes as hex (86 chars)" },
      400,
    );
  }

  // Amount is a u64. Accept a decimal string or number and reject anything
  // outside the u64 range rather than silently truncating.
  let amount;
  try {
    amount = BigInt(body.amount ?? 0);
  } catch {
    return json({ error: "amount must be an integer (duffs)" }, 400);
  }
  if (amount < 0n || amount > 18446744073709551615n) {
    return json({ error: "amount out of u64 range" }, 400);
  }

  let memo = new Uint8Array(36);
  if (body.memo !== undefined) {
    const m = hexToBytes(body.memo);
    if (!m || m.length !== 36) {
      return json({ error: "memo must be 36 bytes as hex (72 chars)" }, 400);
    }
    memo = m;
  }

  const dummyOutputs = Number(body.dummyOutputs ?? 0);
  if (!Number.isInteger(dummyOutputs) || dummyOutputs < 0 || dummyOutputs > 8) {
    return json({ error: "dummyOutputs must be an integer 0..8" }, 400);
  }

  const exports = getExports();

  // Cheap liveness check before paying ~30-50 s for keygen. This distinguishes
  // "wasm loaded and runs" from "wasm loaded but the toolchain is broken".
  if (exports.sanity() !== 925) {
    return json({ error: "prover wasm failed its sanity check" }, 500);
  }

  const pkWasCached = exports.pk_is_cached() === 1;
  const tPk0 = Date.now();
  if (exports.pk_build() !== 1) {
    return json({ error: `proving key build failed: ${readError(exports)}` }, 500);
  }
  const pkMs = Date.now() - tPk0;

  writeBytes(exports, recipient, SCRATCH_RECIPIENT);
  writeBytes(exports, memo, SCRATCH_MEMO);

  // OOM/CPU timing is measured here in JS on purpose. `wasm32-unknown-unknown`
  // has no clock: `std::time::Instant::now()` panics with
  // "time not implemented on this platform", so the wasm cannot time itself.
  const tBuild0 = Date.now();
  const ok = exports.build_bundle(
    SCRATCH_RECIPIENT,
    amount,
    SCRATCH_MEMO,
    dummyOutputs,
  );
  const buildMs = Date.now() - tBuild0;

  if (ok !== 1) {
    return json({ error: `bundle build failed: ${readError(exports)}` }, 500);
  }

  const actionCount = exports.action_count();
  if (actionCount === 0) {
    return json({ error: "prover returned zero actions" }, 500);
  }

  // Copy every result out of the wasm heap before returning. The pointers are
  // only valid until the next call that can grow memory.
  const actionsLen = exports.actions_len();
  const actions = new Uint8Array(
    exports.memory.buffer.slice(
      exports.actions_ptr(),
      exports.actions_ptr() + actionsLen,
    ),
  );
  const proofLen = exports.proof_len();
  const proof = new Uint8Array(
    exports.memory.buffer.slice(
      exports.proof_ptr(),
      exports.proof_ptr() + proofLen,
    ),
  );
  const anchor = new Uint8Array(
    exports.memory.buffer.slice(exports.anchor_ptr(), exports.anchor_ptr() + 32),
  );
  const bindingSignature = new Uint8Array(
    exports.memory.buffer.slice(
      exports.binding_signature_ptr(),
      exports.binding_signature_ptr() + 64,
    ),
  );

  const valueBalance = exports.value_balance(); // BigInt: negative = into pool
  const flags = exports.bundle_flags();

  // Split the packed action blob (408 bytes each) into named fields so the
  // browser does not have to know the layout:
  //   nullifier(32) || rk(32) || cmx(32) || encrypted_note(216) ||
  //   cv_net(32) || spend_auth_sig(64)
  const ACTION_LEN = 408;
  const serializedActions = [];
  for (let i = 0; i < actionCount; i++) {
    const a = actions.subarray(i * ACTION_LEN, (i + 1) * ACTION_LEN);
    serializedActions.push({
      nullifier: bytesToHex(a.subarray(0, 32)),
      rk: bytesToHex(a.subarray(32, 64)),
      cmx: bytesToHex(a.subarray(64, 96)),
      encryptedNote: bytesToHex(a.subarray(96, 312)),
      cvNet: bytesToHex(a.subarray(312, 344)),
      // Named to match rs-dpp's `SerializedAction.spend_auth_sig`.
      spendAuthSig: bytesToHex(a.subarray(344, 408)),
    });
  }

  return json({
    // `OrchardBundleParams` (`platform/packages/rs-dpp/src/shielded/mod.rs:85`)
    // plus the `SerializedBundle` extras (`flags`, `valueBalance`) from
    // `serialize_authorized_bundle` (.../builder/mod.rs:108).
    actions: serializedActions,
    anchor: bytesToHex(anchor),
    proof: bytesToHex(proof),
    bindingSignature: bytesToHex(bindingSignature),
    flags,
    valueBalance: valueBalance.toString(),
    // Non-secret diagnostics. Useful because a cold isolate pays keygen.
    meta: {
      actionCount,
      proofLen,
      pkWasCached,
      pkMs,
      buildMs,
      instanceInitMs,
      isolateId: isolateId(),
      requestCountInIsolate: requestCount,
    },
  });
}

/**
 * POST /prove/pczt
 *
 * Spend-proof path (transfer / unshield / withdrawal). The body is the
 * raw wire-format frame from `docs/design-pczt-wire-format.md` — the client
 * builds and signs the PCZT in the browser (build_for_pczt -> signer ->
 * io_finalize, all pre-send) and this endpoint runs ONLY the Prover role.
 *
 * Trust model (docs/reply-evonext-spend-proofs-v2.md): the frame carries no
 * `ask` and no `bsk`. The fields it does carry (fvk, note plaintexts,
 * witness, alpha, rcv) are exactly the fork prover's requirements
 * (pczt/prover.rs:60-77); none of them enable a spend.
 *
 * Response: JSON with the SAME frame (plus `zkProof` set) as hex, so the
 * client parses it with the same parser it used to build the request. The
 * response contains no decisions — it is byte-identical to the request except
 * for the appended proof.
 */
async function handlePczt(request) {
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length === 0) {
    return json({ error: "empty request body; expected the raw wire frame" }, 400);
  }
  // Generous cap: even 100 actions (~185 KB) fits; a bigger body is either a
  // bug or an attack, and the wasm scratch region must not be filled by a
  // single request.
  if (body.length > 1 << 20) {
    return json({ error: `request too large (${body.length} bytes; max ${1 << 20})` }, 413);
  }

  const exports = getExports();
  if (exports.sanity() !== 925) {
    return json({ error: "prover wasm failed its sanity check" }, 500);
  }

  const pkWasCached = exports.pk_is_cached() === 1;
  const tPk0 = Date.now();
  if (exports.pk_build() !== 1) {
    return json({ error: `proving key build failed: ${readError(exports)}` }, 500);
  }
  const pkMs = Date.now() - tPk0;

  writeBytes(exports, body, SCRATCH_PCZT);

  // Timing here in JS for the same reason as /prove/shield: wasm has no clock.
  const tProve0 = Date.now();
  const result = exports.prove_pczt(SCRATCH_PCZT, body.length);
  const proveMs = Date.now() - tProve0;

  if (result !== 1) {
    return json(
      { error: `prove_pczt failed`, errorCode: result, detail: readError(exports) },
      500,
    );
  }

  const responseLen = exports.pczt_response_len();
  const response = new Uint8Array(
    exports.memory.buffer.slice(
      exports.pczt_response_ptr(),
      exports.pczt_response_ptr() + responseLen,
    ),
  );

  return json({
    // Same wire frame as the request, with `zkProof` set. The client
    // (docs/design-pczt-wire-format.md §5) parses this with its own parser,
    // then runs extract + apply_binding_signature and broadcasts.
    response: bytesToHex(response),
    responseLen,
    meta: {
      requestLen: body.length,
      pkWasCached,
      pkMs,
      proveMs,
      instanceInitMs,
      isolateId: isolateId(),
      requestCountInIsolate: requestCount,
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/prove/shield") {
      if (request.method !== "POST") {
        return json({ error: "method not allowed, use POST" }, 405);
      }
      try {
        return await handleShield(request);
      } catch (e) {
        return json({ error: `internal error: ${e?.message ?? String(e)}` }, 500);
      }
    }

    if (url.pathname === "/prove/pczt") {
      if (request.method !== "POST") {
        return json({ error: "method not allowed, use POST" }, 405);
      }
      try {
        return await handlePczt(request);
      } catch (e) {
        return json({ error: `internal error: ${e?.message ?? String(e)}` }, 500);
      }
    }

    if (url.pathname === "/health") {
      // Deliberately does NOT build the proving key: a health check must be
      // cheap, and keygen takes tens of seconds.
      const exports = getExports();
      return json({
        ok: true,
        sanity: exports.sanity(),
        pkIsCached: exports.pk_is_cached() === 1,
        instanceInitMs,
        isolateId: isolateId(),
        requestCountInIsolate: ++requestCount,
      });
    }

    return json({ error: "not found" }, 404);
  },
};
