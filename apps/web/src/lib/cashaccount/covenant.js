// apps/web/src/lib/cashaccount/covenant.js
//
// The CashAccounts v2 covenants, verbatim from the spec's appendices, plus
// the artifact helpers the wallet needs to build and recognize an account.
//
// Compilation is a BUILD-HOST step (CashScript 0.13.0): the compiled P2S
// scripts are NOT committed here because the spec does not publish their
// bytes, and this module refuses to fabricate them. The expected byte sizes
// are the spec's acceptance values (lines 677, 725, 785, 826).
//
// The resolver verifies live accounts against the ON-CHAIN locking script
// (ChainGraph returns it), not against a local compilation.

import { binToHex, hexToBin, sha256 } from '@bitauth/libauth'
import { normalizeHex } from './identifier.js'

export const CASHSCRIPT_VERSION = '0.13.0'

/* The spec's compiled byte sizes. */
export const COMPILED_SIZES = {
    genesis: 177,
    identity: 197,
    migrationGuard: 109,
    upgradeTicket: 165,
}

/* Appendix A — CashAccount Genesis Covenant. */
export const GENESIS_COVENANT_SOURCE = `pragma cashscript ^0.13.0;

contract CashAccountGenesis(pubkey spendKey, bytes32 identityScriptHash) {
    function register(bytes ownerSig, bytes keySigs) {
        require(this.activeInputIndex == 0);
        require(tx.inputs[0].outpointIndex == 0);
        require(tx.inputs[0].tokenCategory == 0x);

        bytes category = tx.inputs[0].outpointTransactionHash + 0x01;
        require(tx.outputs[0].tokenCategory == category);

        bytes identityScript = tx.outputs[0].lockingBytecode;
        require(sha256(identityScript) == identityScriptHash);
        require(identityScript.split(34)[0] == 0x21 + bytes(spendKey));

        bytes version, bytes fields = tx.outputs[0].nftCommitment.split(1);
        require(version == 0x02);
        bytes scanKey, bytes tail = fields.split(2)[1].split(33);
        bytes nostrKey = tail.split(4)[1];

        bytes scanSig, bytes nostrSig = keySigs.split(64);
        require(checkSig(sig(scanSig + 0x61), pubkey(scanKey)));
        if (nostrKey != 0x) {
            require(nostrKey.length == 32);
            require(checkSig(sig(nostrSig + 0x61), pubkey(0x02 + nostrKey)));
        } else {
            require(nostrSig == 0x);
        }

        require(tx.outputs[1].lockingBytecode.split(6)[0] == 0x6a0401010102);
        require(checkSig(sig(ownerSig + 0x61), spendKey));
    }
}
`

/* Appendix B — CashAccount Identity Covenant (the live P2S lock). */
export const IDENTITY_COVENANT_SOURCE = `pragma cashscript 0.13.0;

contract CashAccountV2(pubkey spendKey) {
    function spend(bytes ownerSig, bytes spendSig, bytes scanSig, bytes nostrSig) {
        require(this.activeInputIndex == 0);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);

        bytes nextScript = tx.outputs[0].lockingBytecode;
        if (nextScript != 0x6a) {
            bytes commitment = tx.outputs[0].nftCommitment;
            if (commitment == 0xff02) {
                require(nextScript.split(35)[0] == 0x21 + bytes(spendKey) + 0x20);
                require(hash160(nextScript.split(67)[1]) == 0xcd13172484499df974b6e56edbdad7d6f4c75712);
            } else {
                bytes scriptPrefix, bytes covenantBody = nextScript.split(34);
                require(covenantBody == this.activeBytecode.split(34)[1]);
                bytes keyPush, bytes nextSpendKey = scriptPrefix.split(1);
                require(keyPush == 0x21);
                require(checkSig(sig(spendSig + 0x61), pubkey(nextSpendKey)));

                bytes header, bytes tail = commitment.split(36);
                require(header.split(1)[0] == 0x02);
                require(header.split(2)[0] == tx.inputs[0].nftCommitment.split(2)[0]);
                bytes scanKey = header.split(3)[1];
                require(checkSig(sig(scanSig + 0x61), pubkey(scanKey)));

                bytes nostrKey = tail.split(4)[1];
                if (nostrKey == 0x) {
                    require(nostrSig == 0x);
                } else {
                    require(checkSig(sig(nostrSig + 0x61), pubkey(0x02 + nostrKey)));
                }
            }
        }

        require(checkSig(sig(ownerSig + 0x61), spendKey));
    }
}
`

/* Appendix C — CashAccount Migration Covenant. */
export const MIGRATION_GUARD_SOURCE = `pragma cashscript ^0.13.0;

contract MigrationGuard(bytes32 ticketScriptHash, pubkey spendKey) {
    function activate(bytes ownerSig) {
        require(this.activeInputIndex == 0);
        require(tx.inputs[0].nftCommitment == 0xff02);

        bytes category = tx.inputs[0].tokenCategory;
        require(category.split(32)[1] == 0x01);
        require(tx.outputs[0].tokenCategory == category);

        require(sha256(tx.inputs[1].lockingBytecode) == ticketScriptHash);
        bytes ticketCommitment = tx.inputs[1].nftCommitment;
        require(ticketCommitment.split(1)[0] == 0x03);
        require(tx.outputs[0].nftCommitment == ticketCommitment);

        require(checkSig(sig(ownerSig + 0x61), spendKey));
    }
}
`

/* Appendix D — Example Migration NFT Covenant. */
export const UPGRADE_TICKET_SOURCE = `pragma cashscript ^0.13.0;

contract UpgradeTicket(bytes32 identityCategory, bytes32 nextScriptHash) {
    function approve(bytes keySigs) {
        require(this.activeInputIndex == 1);
        require(tx.inputs[0].tokenCategory == identityCategory + 0x01);
        require(tx.inputs[0].nftCommitment == 0xff02);

        bytes nextScript = tx.outputs[0].lockingBytecode;
        require(sha256(nextScript) == nextScriptHash);
        bytes keyPush, bytes scriptTail = nextScript.split(1);
        require(keyPush == 0x21);
        bytes spendKey = scriptTail.split(33)[0];

        bytes ticketCommitment = tx.inputs[1].nftCommitment;
        require(tx.outputs[0].nftCommitment == ticketCommitment);
        bytes version, bytes fields = ticketCommitment.split(1);
        require(version == 0x03);
        bytes scanKey, bytes tail = fields.split(2)[1].split(33);
        bytes nostrKey = tail.split(4)[1];

        bytes spendSig, bytes otherSigs = keySigs.split(64);
        bytes scanSig, bytes nostrSig = otherSigs.split(64);
        require(checkSig(sig(spendSig + 0x61), pubkey(spendKey)));
        require(checkSig(sig(scanSig + 0x61), pubkey(scanKey)));
        if (nostrKey != 0x) {
            require(nostrKey.length == 32);
            require(checkSig(sig(nostrSig + 0x61), pubkey(0x02 + nostrKey)));
        } else {
            require(nostrSig == 0x);
        }
    }
}
`

/**
 * The CashCode spending public key is the 33-byte push at the head of the
 * compiled Identity Covenant: `0x21 || pubkey`.
 *
 * @param {Uint8Array|string} identityScript - compiled P2S locking bytecode
 * @returns {string} 33-byte compressed pubkey, lowercase hex
 */
export function spendPubkeyFromIdentityScript(identityScript) {
    const bytes = typeof identityScript === 'string'
        ? hexToBin(normalizeHex(identityScript))
        : identityScript

    if (!(bytes instanceof Uint8Array) || bytes.length < 34 || bytes[0] !== 0x21) {
        throw new Error('covenant: identity script must start with 0x21 + a 33-byte pubkey')
    }

    return binToHex(bytes.slice(1, 34))
}

/**
 * The Genesis Covenant's `identityScriptHash` parameter: SHA-256 of the
 * compiled Identity Covenant locking bytecode (spec line 669).
 *
 * @param {Uint8Array|string} identityScript
 * @returns {string} 32-byte hash, lowercase hex
 */
export function identityScriptHash(identityScript) {
    const bytes = typeof identityScript === 'string'
        ? hexToBin(normalizeHex(identityScript))
        : identityScript

    return binToHex(sha256.hash(bytes))
}

/**
 * Validate a compiled artifact against the spec's expected size.
 *
 * @param {'genesis'|'identity'|'migrationGuard'|'upgradeTicket'} kind
 * @param {Uint8Array|string} script
 * @returns {Uint8Array}
 */
export function assertCompiledArtifact(kind, script) {
    const bytes = typeof script === 'string'
        ? hexToBin(normalizeHex(script))
        : script
    const expected = COMPILED_SIZES[kind]

    if (!expected) {
        throw new Error(`covenant: unknown artifact kind ${kind}`)
    }

    if (!(bytes instanceof Uint8Array) || bytes.length !== expected) {
        throw new Error(`covenant: ${kind} must compile to ${expected} bytes (got ${bytes ? bytes.length : 'none'})`)
    }

    return bytes
}
