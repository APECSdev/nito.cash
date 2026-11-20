/* Import crypto helpers (local tx build + Schnorr sign). */
import {
    addressToLockingBytecode,
    buildTransaction,
    encodeTransactionToHex,
    estimateByteCount,
} from '@/lib/bch/crypto.js'

/* Import the Fulcrum provider (broadcast + UTXO lookups). */
import { getCluster } from '@/lib/bch/provider.js'

/**
 * Send Crypto
 */
const sendCrypto = async ({ dispatch, getters, rootGetters }, _params) => {
    // console.log('SENDING CRYPTO', _params)

    /* Set dust amount. */
    const dustAmount = 546

    /* Set receiver address. */
    const receiver = _params.receiver
    // console.log('RECEIVER (address)', receiver)

    /* Validate (receiver) address. NOTE: libauth's CashAddress utilities
       return an error STRING (not a throw) on invalid input, and an
       unparseable value can also throw — either way the address must be
       rejected BEFORE it reaches the (unsigned) transaction (previously an
       invalid address failed silently, mid-send). */
    let receiverValid = false

    try {
        receiverValid = !!addressToLockingBytecode(receiver)
    } catch (err) {
        receiverValid = false
    }

    /* Validate receiver. */
    if (!receiverValid) {
        /* Set error message. */
        const error = new Error('Invalid receiver address.')

        /* Warn user. */
        dispatch('displayError', error, { root: true })

        /* Stop (send) execution. */
        /* Throw (AFTER the warning) so the caller's rejection handler runs — a
           resolved action made the Send view show the \"complete\" state on
           FAILED sends. */
        throw error
    }

    /* Set send amount. */
    const amount = parseFloat(_params.amount)
    // console.log('AMOUNT (raw)', amount)

    /* Set unit (normalized: the UI emits mixed-case units, the conversion
       table below is uppercase). */
    const unit = String(_params.unit || '').toUpperCase()
    // console.log('UNIT', unit)

    /* Initialize has (a) change (output). */
    let hasChange = false

    /* Validate (send) amount. */
    if (!amount) {
        /* Set error message. */
        const error = new Error('Enter an amount to send.')

        /* Warn user. */
        dispatch('displayError', error, { root: true })

        /* Stop (send) execution. */
        /* Throw (AFTER the warning) so the caller's rejection handler runs — a
           resolved action made the Send view show the \"complete\" state on
           FAILED sends. */
        throw error
    }

    /* Initialize HD node. */
    const hdNode = getters.getHDNode

    /* Initialize accounts. */
    // NOTE: The original called `getAddresses(state, getters)('BCH')` with an
    //       (undefined) `state`; we resolve the getter through the (local)
    //       getters proxy, which binds state correctly.
    const accounts = getters.getAddresses('BCH')
    // console.log('ACCOUNTS', accounts)

    /* Initialize available inputs. */
    const availableInputs = []

    /* Initialize account (pool) indexes. */
    const accountIndexes = []

    /* Initialize the Fulcrum cluster (for the active network). */
    const cluster = await getCluster(rootGetters['profile/getNetwork'])

    /* Set the account base — getDerivationPath returns the branch-0 base
       (`m/44'/145'/0'/0` = purpose'/coin'/account'/change); slice(0, 4)
       keeps `m/44'/145'/0'` (dropping the change level — NOT the account
       level, which slice(0, 3) would and which derives a different
       wallet). DISCOVERED branch-1 (foreign change chain) entries sign
       from `${accountBase}/1/${index}`. The path is carried PER INPUT
       (getSignedInput derives the key from it). */
    const accountBase = getters.getDerivationPath('BCH').split('/').slice(0, 4).join('/')

    /* Retrieve (account) unspent outputs (UTXOs) — one query per address. */
    for (const account of accounts) {
        // FIXME: Add support for multiple unspents for one account address.
        const utxos = await cluster.getUtxos(account.address)

        /* Validate unspents. */
        if (utxos && utxos.length > 0) {
            /* Set (account) address. */
            const address = account.address

            /* Set derivation path (branch-aware). */
            const path = account.branch === 1
                ? `${accountBase}/1/${account.index}`
                : `${getters.getDerivationPath('BCH')}/${account.index}`

            /* Add account index. */
            accountIndexes.push(account.index)

            /* Add available input. */
            availableInputs.push({
                address,
                path,
                txid: utxos[0].tx_hash,
                vout: utxos[0].tx_pos,
                satoshis: utxos[0].value,
            })
        }
    }

    /* Validate available inputs. */
    if (availableInputs.length === 0) {
        /* Set error message. */
        const error = new Error('You have NO money!')
        // console.error(error) // eslint-disable-line no-console

        /* Warn user. */
        dispatch('displayError', error, { root: true })

        /* Stop (send) execution. */
        /* Throw (AFTER the warning) so the caller's rejection handler runs — a
           resolved action made the Send view show the \"complete\" state on
           FAILED sends. */
        throw error
    }

    /* Initialize send amount. */
    let sendAmount = null

    /* Set send amount (in satoshis).
       NOTE: every case is ROUNDED — binary floating point makes conversions
       like `0.01 mBCH * 1e5` evaluate to 1000.0000000000001, and
       buildTransaction() calls BigInt() on the output value, which THROWS
       (RangeError: not an integer) on a non-integer satoshi amount. A user
       sending 0.01 mBCH crashed the send path before this rounding. */
    switch(unit) {
    case 'SATOSHIS':
        sendAmount = Math.round(amount)
        break
    case 'BITS':
        sendAmount = Math.round(amount * Math.pow(10, 2))
        break
    case 'MBCH':
        sendAmount = Math.round(amount * Math.pow(10, 5))
        break
    case 'BCH':
        sendAmount = Math.round(amount * Math.pow(10, 8))
        break
    }

    /* Validate (the unit conversion produced) a send amount. */
    if (!sendAmount) {
        /* Set error message. */
        const error = new Error('Unsupported amount unit: ' + unit + '.')

        /* Warn user. */
        dispatch('displayError', error, { root: true })

        /* Stop (send) execution. */
        /* Throw (AFTER the warning) so the caller's rejection handler runs — a
           resolved action made the Send view show the \"complete\" state on
           FAILED sends. */
        throw error
    }

    /* Initialize byte count. */
    // FIXME: Calculate the CORRECT byte count.
    let byteCount = 226 // TEMP: This is the size of a "standard" transaction

    /* Set transaction (send) amount. */
    // FIXME: What happens if a change output is required??
    let txAmount = sendAmount + byteCount
    // console.log('TX AMOUNT', txAmount)

    /* Initialize inputs count. */
    let inputsCount = 0

    /* Initialize total (value) of inputs. */
    let inputsTotal = 0

    /* Initialize the inputs actually added to the transaction. */
    // (The original signed ALL available inputs — including any not added to
    //  the transaction; here we track — and later sign — only those added.)
    const addedInputs = []

    /* Process (available) inputs.
       NOTE: The (network) fee depends on the FINAL input/output counts, so
       selection re-validates as inputs are added: the byte count (and the
       transaction amount) is recalculated after every input, pulling more
       (available) inputs until the amount + fee is covered. (The original
       selection ran against the initial hardcoded byte estimate, which could
       leave the recomputed fee uncovered.) The estimate conservatively
       assumes a change output (2 outputs); the final re-calculation below
       uses the actual output count. */
    let selectionIndex = 0

    while (selectionIndex < availableInputs.length && inputsTotal < txAmount) {
        /* Add input. */
        const input = availableInputs[selectionIndex]
        addedInputs.push(input)

        /* Add satoshis to total. */
        inputsTotal += input.satoshis

        /* Increment inputs count. */
        inputsCount++

        /* Advance (selection) index. */
        selectionIndex++

        /* Recalculate byte count (with the growing input count). */
        byteCount = estimateByteCount(inputsCount, 2)

        /* Set transaction amount. */
        txAmount = sendAmount + byteCount
    }

    /* Validate tx amount. */
    if (inputsTotal < txAmount) {
        /* Set error message. */
        const error = new Error('Insufficient balance: ' +
            'your account balance is too low to cover the network fees. ' +
            'Please reduce the send amount.')
        // console.error(error) // eslint-disable-line no-console

        /* Warn user. */
        dispatch('displayError', error, { root: true })

        /* Stop (send) execution. */
        /* Throw (AFTER the warning) so the caller's rejection handler runs — a
           resolved action made the Send view show the \"complete\" state on
           FAILED sends. */
        throw error
    }

    /* Validate send amount. */
    if (sendAmount < dustAmount) {
        /* Set error message. */
        const error = new Error('Send amount is too small. ' +
            'Please send at least ' + dustAmount + ' satoshis.')
        // console.error(error) // eslint-disable-line no-console

        /* Warn user. */
        dispatch('displayError', error, { root: true })

        /* Stop (send) execution. */
        /* Throw (AFTER the warning) so the caller's rejection handler runs — a
           resolved action made the Send view show the \"complete\" state on
           FAILED sends. */
        throw error
    }

    /* Build the transaction outputs. */
    const outputs = []

    /* Add output (receiver). */
    outputs.push({ address: receiver, satoshis: sendAmount })

    /* Complete outputs (to change address). */
    if (sendAmount < inputsTotal) {
        /* Calculate change amount. */
        const changeAmount = inputsTotal - txAmount

        /* Validate change amount. */
        if (changeAmount >= dustAmount) {
            /* Set change flag. */
            hasChange = true

            /* Set change address. */
            // NOTE: The original called `getters.getChangeAddress` with NO
            //       wallet argument, which (via getAccountsByWallet(undefined))
            //       always returned `null` — breaking change outputs. We pass
            //       'BCH' to resolve a valid (network-prefixed) change address.
            const changeAddress = getters.getChangeAddress('BCH')
            // console.log('SEND (change address)', changeAddress)

            /* Add output (change). */
            outputs.push({ address: changeAddress, satoshis: changeAmount })
        }
    }

    /* Calculate byte count. */
    if (hasChange) {
        byteCount = estimateByteCount(inputsCount, 2)
    } else {
        byteCount = estimateByteCount(inputsCount, 1)
    }
    // console.log('BYTE COUNT', byteCount)

    /* Set transaction amount. */
    // FIXME: We MUST re-validate (re-calculate) against this value.
    txAmount = sendAmount + byteCount
    // console.log('TX AMOUNT', txAmount)

    /* Build the (unsigned) transaction bundle. */
    const bundle = buildTransaction(addedInputs, outputs)

    /* Sign input(s). */
    // NOTE: `getSignedInput` is now async (WASM Schnorr); sign sequentially.
    for (let index = 0; index < addedInputs.length; index++) {
        await getters.getSignedInput(bundle, hdNode, index, addedInputs[index])
    }

    /* Encode the (signed) transaction to raw hex. */
    const rawTx = encodeTransactionToHex(bundle.transaction)
    // console.log('RAW (signed tx)', rawTx)

    /* Broadcast the (signed) transaction. */
    // NOTE: The broadcast promise is RETURNED so the caller (eg. the Send
    //       view) can drive its (send) state machine; every failure path
    //       warns the user first, then re-throws for the caller.
    return cluster.broadcast(rawTx).then((result) => {
        console.log('TX RESULT', result) // eslint-disable-line no-console

        /* Update accounts (pool). */
        // NOTE: It's CRITICAL that we dispatch the account pool update
        //       BEFORE calling nextAccount().
        if (hasChange) {
            /* Next account. */
            // FIXME: Handle ALL wallet types: BAI, BCH, DAI, NITO
            dispatch('nextAccount', 'BCH')
        }

        /* Update accounts (pool). */
        dispatch('updateAccounts', {
            action: 'disable',
            indexes: accountIndexes,
            wallet: 'BCH',
        })

        /* Notify user. */
        dispatch('displayNotification', 'Sent successfully!', { root: true })
    }, (_error) => {
        console.log('TX ERROR', _error) // eslint-disable-line no-console

        /* Validate (insufficient fee) error. */
        if ((_error.message || '').indexOf('insufficient priority') !== -1) {
            /* Replace with a friendlier error message. */
            _error = new Error('Transaction rejected due to low network fees. ' +
                'Please reduce the send amount.')
        }

        /* Propagate the failure (the trailing catch warns the user + rejects
           so the caller can reset its UI state). */
        throw _error
    }).catch((_error) => {
        /* Warn user. */
        dispatch('displayError', _error, { root: true })

        /* Propagate the failure (callers reset their UI state on rejection). */
        throw _error
    })
}

/* Export module. */
export default sendCrypto
