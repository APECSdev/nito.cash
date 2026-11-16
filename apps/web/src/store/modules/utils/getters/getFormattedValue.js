/* Import modules. */
// const numeral = require('numeral')
import numeral from 'numeral'

/**
 * Get Formatted Value
 *
 * Format BCH value to value units and calculate market value.
 */
const getFormattedValue = () => (_satoshis, _marketPrice, _currency) => {
    // console.log('CURRENCY', _currency)
    // let value = getIotas(iotas, units, marketPrice)
    let value = _satoshis

    let unit = 'sats'

    /* Without a market price there is NO fiat conversion — return null (the
       callers render an empty fiat line) rather than a misleading "$0.00".
       (A failed CoinGecko ticker previously made getBalance return null
       entirely, zeroing the Send guard on a FUNDED wallet.) */
    let fiat = _marketPrice
        ? ((_satoshis / 100000000) * (_marketPrice / 100.0))
        : null
    fiat = _marketPrice
        ? numeral(fiat).format('$0,0.00[00]') + ' ' + _currency
        : null

    // const fiat = !_marketPrice
    //     ? '-'
    //     : (_marketPrice.value * (value / 1000000)).toLocaleString('en-US', {
    //           style: '_currency',
    //           currency: _marketPrice.currency,
    //           minimumFractionDigits: 2,
    //           maximumFractionDigits: 5
    //       })

    /* Adjust value and unit (based on size of balance). */
    switch (true) {
    case value < 100:
        break
    case value < 100000:
        value /= 100
        unit = 'bits'
        break
    case value < 100000000:
        value /= 100000
        unit = 'mBCH'
        break
    default:
        value /= 100000000
        unit = 'BCH'
        break
    }

    /* Exact-decimal display: at least 4 decimals, up to 8 (sats-derived
       values are exact within 8 decimals — bits carry 2, mBCH 5, BCH 8).
       Trailing zeros are trimmed only DOWN TO 4 decimals. (The old
       1-decimal round + "+" marker hid the precision the wallet actually
       has — user-requested change: "show at least 4 decimals, up to 8,
       if available".) */
    const exactDecimals = (v) => {
        const s = (Number.isFinite(v) ? v : 0).toFixed(8)

        /* Trim trailing zeros but never below 4 decimals. */
        let t = s
        while (t.endsWith('0') && (t.length - t.indexOf('.') - 1) > 4) {
            t = t.slice(0, -1)
        }
        return t
    }
    const rounded = exactDecimals(value)

    /* Return (formatted) value. NOTE: `satoshis` is the RAW satoshi amount
       (exact, unit-independent) so views that need a precise, unit-safe
       number (e.g. the Naked Vault BCH display) can format it themselves. */
    return {
        satoshis: _satoshis,
        value,
        rounded,
        unit,
        fiat
    }
}

/* Export module. */
export default getFormattedValue
