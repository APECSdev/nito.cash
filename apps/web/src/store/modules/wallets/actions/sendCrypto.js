/* Import crypto helpers (local tx build + Schnorr sign). */
import {
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

    /* Set send amount. */
    const amount = parseFloat(_params.amount)
    // console.log('AMOUNT (raw)', amount)

    /* Set unit. */
    const unit = _params.unit
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
        return
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

    /* Retrieve (account) unspent outputs (UTXOs) — one query per address. */
    for (const account of accounts) {
        // FIXME: Add support for multiple unspents for one account address.
        const utxos = await cluster.getUtxos(account.address)

        /* Validate unspents. */
        if (utxos && utxos.length > 0) {
            /* Set (account) address. */
            const address = account.address

            /* Set derivation path. */
            const path = `${getters.getDerivationPath('BCH')}/${account.index}`

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
        return
    }

    /* Initialize send amount. */
    let sendAmount = null

    /* Set send amount (in satoshis). */
    switch(unit) {
    case 'SATOSHIS':
        sendAmount = amount
        break
    case 'BITS':
        sendAmount = amount * Math.pow(10, 2)
        break
    case 'MBCH':
        sendAmount = amount * Math.pow(10, 5)
        break
    case 'BCH':
        sendAmount = amount * Math.pow(10, 8)
        break
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

    /* Process (available) inputs. */
    availableInputs.forEach(input => {
        if (inputsTotal < txAmount) {
            /* Add input. */
            addedInputs.push(input)

            /* Add satoshis to total. */
            inputsTotal += input.satoshis

            /* Increment inputs count. */
            inputsCount++
        }
    })

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
        return
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
        return
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
    cluster.broadcast(rawTx).then((result) => {
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
        if (_error.message.indexOf('insufficient priority') !== -1) {
            /* Set error message. */
            const error = new Error('Transaction rejected due to low network fees. ' +
                'Please reduce the send amount.')
            // console.error(error) // eslint-disable-line no-console

            /* Warn user. */
            dispatch('displayError', error, { root: true })
        } else {
            /* Warn user. */
            dispatch('displayError', _error, { root: true })
        }
    }).catch((_error) => {
        /* Warn user. */
        dispatch('displayError', _error, { root: true })
    })
}

/* Export module. */
export default sendCrypto
