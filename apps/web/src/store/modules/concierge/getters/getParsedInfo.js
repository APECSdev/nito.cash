/**
 * Get Parsed Info
 *
 * Will attempt to decode the data provided and return an object
 * of "usable" data.
 */
const getParsedInfo = () => (_data) => {
    console.log('INCOMING CONCIERGE DATA', _data)

    /* Initialize info. */
    let info = null

    /* Initialize decoded flag. */
    let decoded = false

    try {
        /* Decode _data to buffer. */
        _data = Buffer.from(_data, 'base64')
        console.log('DATA (buffer)', _data)

        console.log('DATA (string)', _data.toString())

        _data = JSON.parse(_data.toString())
        console.log('DATA (parsed)', _data)
    } catch (err) {
        console.error(err)
    }

    /* Validate decoded. */
    if (!decoded) {
        /* Initialize null count. */
        let nullCount = 0

        try {
            console.log('DATA (failed)', _data)

            for (let i = 0; i < _data.length; i++) {
                if (_data[i] !== 0) {
                    nullCount++
                }
            }

            /* Initialize cleaned buffer. */
            const cleaned = Buffer.alloc(nullCount)

            /* Initialize buffer index. */
            let index = 0

            for (let i = 0; i < _data.length; i++) {
                if (_data[i] !== 0) {
                    cleaned[index++] = _data[i]
                }
            }

            /* Set cleaned data. */
            _data = cleaned

            console.log('CLEAN BUFFER (string)', _data.toString())
            console.log('CLEAN BUFFER (hex)', _data.toString('hex'))

            _data = JSON.parse(_data)
            console.log('DATA (parsed)', _data)

            const outputs = _data.outputs
            console.log('DATA (outputs)', outputs)

            const output = outputs[0]

            const value = output.value
            console.log('DATA (output.value)', value)

            const address = output.address
            console.log('DATA (output.address)', address)

            const data = _data.data
            console.log('DATA (data)', data)

            const donation = _data.donation
            console.log('DATA (donation)', donation)

            const expires = _data.expires
            console.log('DATA (expires)', expires)

            info = _data

        } catch (err) {
            console.error(err)
        }
    }

    /* Return info. */
    return info
}

/* Export module. */
export default getParsedInfo
