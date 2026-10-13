/* Import crypto helpers (local key derivation + P2PKH Schnorr signing). */
import {
    derivePath,
    toPrivateKeyBytes,
    toPublicKeyBytes,
    signP2pkhInput,
} from '@/lib/bch/crypto.js'

/**
 * Get Signed Input
 */
const getSignedInput = () => async (_transactionBundle, _hdNode, _index, _input) => {
    // console.log('GET SIGNED INPUT', _index, _input)

    /* Set _input. */
// TEMP: FOR DEVELOPMENT PURPOSES ONLY
    // const input = _inputs[0]
    // console.log('ADDRESS (of signed input)', _input.address)
    // console.log('PATH (of signed input)', _input.path)

    /* Initialize child node. */
    const childNode = derivePath(_hdNode, _input.path)

    /* Set (signing) keys. */
    const privateKey = toPrivateKeyBytes(childNode)
    const publicKey = toPublicKeyBytes(childNode)

    /* Set (signing) amount. */
    // const amount = parseInt(_input.satoshis)
    // console.log('SIGNING AMOUNT', amount)

    /* Initialize redeemscript. */
    // TODO: Find out WHY the hell we need this here??
    // (Not required for P2PKH — retained from the original BITBOX call.)

    /* Sign the transaction input(s). */
    // FIXME: Allow for multipe inputs.
    // (BCH Schnorr + SIGHASH_ALL | SIGHASH_FORKID.)
    await signP2pkhInput(_transactionBundle, _index, privateKey, publicKey)
}

/* Export module. */
export default getSignedInput
