// apps/web/tests/fixtures/cashaccount-kallisti.js
//
// The live mainnet CashAccounts v2 registration 8267bff0… ("Kallisti",
// block 978459, transaction_index 41), captured from ChainGraph on
// 2026-11-23 and normalized to the resolver's transaction shape.
//
// Used by the CashAccounts unit tests; no network access.

export const KALLISTI_TX = {
    hash: '8267bff0bf6532bfd109ecae1062deb88822166333de5ece52d4309371a42878',
    block: {
        height: 978459,
        hash: '00000000000000000066a3b894ab1054f896c6554c15bde0ef8215597b88ec8d',
        transactionIndex: 41,
    },
    inputs: [{
        index: 0,
        outpointTransactionHash: '46e5567875706cbdf44a040d66ced15174f64d2b8805884bbe35a93153564111',
        outpointIndex: 0,
    }],
    outputs: [{
        index: 0,
        valueSatoshis: 1389,
        lockingBytecodeHex: '2103cc053f481413acc58895bf8be09eb67b4b4cfb0ace8b7be9f7867c5bce36873dc0009d00d100ce8800cd76016a876400d27602ff0287637801237f75012154797e01207e887801437f77a914cd13172484499df974b6e56edbdad7d6f4c7571288677801227f76c101227f778878517f78012188587901617e78ad547901247f78517f75528878527f7500cf527f758878537f775c7901617e78ad78547f77760087635e790088675e7901617e5252797ead686d6d6d6d6875687b01617e7bad6d6d51',
        tokenCategory: '46e5567875706cbdf44a040d66ced15174f64d2b8805884bbe35a93153564111',
        fungibleAmount: '0',
        nftCapability: 'mutable',
        nftCommitment: '02010802456219ccdc6500d7a681191c7aa4dfcc9937d0e24a6943e828dcccb838bcb2be00000000d8ca572c9f84a1b3c67a4cb9ffd0d8c29aea311430f1e87bd615c9cf48cad7be',
    }, {
        index: 1,
        valueSatoshis: 0,
        lockingBytecodeHex: '6a0401010102084b616c6c6973746912024b616c6c697374692e63617368f09f8d8f150468747470733a2f2f6b616c6c6c697374692e696f',
        tokenCategory: null,
        fungibleAmount: null,
        nftCapability: null,
        nftCommitment: null,
    }],
}

export const KALLISTI_CATEGORY = KALLISTI_TX.outputs[0].tokenCategory
