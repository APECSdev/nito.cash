// tests/unit/store/pool-store-role2-v4h.spec.js
//
// Store-level tests for the v4h (the C architecture) branch of
// pool/submitRole2Action: the genesis + steady flows — the category SPLIT
// (the deposit supply reads the HELD asset), the funding need (the H pair),
// the holdings-line resolution (the prior action's out2, CONSTRUCTED from the
// scan's validated chain), the genesis flag (the first action's lock funds
// the tokenless in5 slot), the witness binding the HELD category, and the
// submit wiring (submitRole2ActionV4h receives { holdings, isGenesis }).
//
// The proving half is MOCKED (the vendored program build + the pinned assets
// are the reproduction spec's + the acceptance's territory); the builders
// have their own spec (pool-role2-v4h-actions.spec.js).

import { createPinia, setActivePinia } from 'pinia'
import piniaPersist from 'pinia-plugin-persistedstate'
import msgpack from 'msgpack-lite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStore, StoreCompatPlugin, ensureStoreFacade, getStoreFacade } from '@/store'

const ENTROPY = 'ab'.repeat(32)
const DEPLOY_TXID = '61022b8b46087f2a5c5b49ae9782d05a316807726cc078995b2291e500efc944'

const POOL = {
    id: 'mainnet-role2-pool4-v4h-test',
    network: 'mainnet',
    variant: 'v4h',
    txInputCount: 7,
    outputs: 3,
    carrierBytes: 201,
    walletProverCompatible: true,
    deployTxid: DEPLOY_TXID,
    assetCategory: '324b1dbfb05c605937f7e68f62210102beacc8b0ece0537e5bde04e90a875814',
    heldCategory: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
    genesisRootLE: '3e1f1922dfb671d3f912f7ea461e0a88ee848fdde12b6c18ab1ad2c56ae73421',
    genesisLeafCount: 0,
    genesisLeaves: [],
    bootstrapNotes: [],
    program: {
        lockingBytecode: 'aa2006d764d4a149900fe8cbe2a0b01753643b21bda74b0fc76018172bfc098dc3c987',
        hLockingHex: 'aa2006fa0f9ebadd88eaac1b8801c69329c6c3e6d9209bced65ed01340a6e4e19b2087',
        progLockingHash: '90f104a34677e1abf90a2e1ad6eddaeece258f6d647b41c94ee563fa0e4946cb',
        walkPins: ['1255489f8168c4110094b0701617278133aa31f43ae4cb341f2f7bdb0f21a002', 'b476695026823fb3466d543ec61bf468fbe434a9c1c861233f3ca2ff09ad8312'],
    },
    fuelSats: 23000,
    walkSats: 2000,
    holdingsSats: 1000,
}

const {
    scanPoolMock, clusterMock, poolsMock, witnessMock, proofMock, walkMock,
    produceMock, holdingsMock, hUnlockingMock, submitMock,
} = vi.hoisted(() => ({
    scanPoolMock: vi.fn(),
    clusterMock: vi.fn(),
    poolsMock: vi.fn(() => []),
    witnessMock: vi.fn(),
    proofMock: vi.fn(),
    walkMock: vi.fn(),
    produceMock: vi.fn(),
    holdingsMock: vi.fn(),
    hUnlockingMock: vi.fn(),
    submitMock: vi.fn(),
}))

vi.mock('@/lib/pool/scan', () => ({ scanPool: scanPoolMock }))
vi.mock('@/lib/pool/registry', async (importOriginal) => ({
    ...(await importOriginal()),
    getPools: poolsMock,
    /* B3 — no mailbox in these tests: the submit hook's delivery is inert
       (the transfer test asserts the hook's null path). */
    getNoteMailbox: vi.fn(() => null),
}))
vi.mock('@/lib/bch/provider', () => ({ getCluster: clusterMock }))
vi.mock('@/lib/pool/prover', async (importOriginal) => ({
    ...(await importOriginal()),
    buildPoolWitnessV3: witnessMock,
    generateProof: proofMock,
}))
vi.mock('@/lib/pool/smt', () => ({ nullifierWalkData: walkMock }))
vi.mock('@/lib/pool/role2-carrier', () => ({ encodeRole2Carrier: vi.fn(() => new Uint8Array(201)) }))
vi.mock('@/lib/pool/carrier', () => ({ ownerPubFromDeliveryPoint: vi.fn(() => 123n) }))
vi.mock('@/lib/pool/verifier-role2-v4h', () => ({
    produceRole2InputsV4h: produceMock,
    v4hHoldingsCovenant: holdingsMock,
    v4hHUnlocking: hUnlockingMock,
}))
vi.mock('@/lib/pool/role2-actions', () => ({
    submitRole2ActionV4h: submitMock,
    matchStandingFuelNotes: vi.fn(),
}))
vi.mock('@/lib/pool/actions', () => ({
    assembleLeaves: vi.fn(() => []),
    selectInNotes: vi.fn(() => ({ picked: [{ note: { value: 1000n } }, { note: { value: 500n } }] })),
    parseDeliveryPoint: vi.fn((x) => x),
    submitPoolAction: vi.fn(),
}))

/* The scan result builder (the store consumes scanPool's return through
   `scanned.scan`). */
const scanOf = (actions) => ({
    address: 'pool-address',
    actions,
    creationTxids: [],
    tipHeight: 979219,
    tipTxid: actions.length ? actions[actions.length - 1].txid : DEPLOY_TXID,
    received: [],
    spent: [],
    spentKeys: [],
    nullSetRoot: 'ab'.repeat(32),
})

describe('store/modules/pool submitRole2Action — the v4h branch', () => {
    let facade

    const seedWallet = () => {
        /* The wallets state: one BCH account (msgpack — the getters decode
           it + derive the addresses from the master seed). */
        facade.state.wallets.a = msgpack.encode({ BCH: { 0: { s: 'a', u: {} } } })
    }

    const mockCluster = (poolUtxos, walletUtxos) => {
        clusterMock.mockReset()
        clusterMock.mockResolvedValue({
            getUtxosWithTokens: async (address) => (address === 'pool-address' ? poolUtxos : walletUtxos),
            broadcast: async (hex) => 'ff'.repeat(32),
        })
    }

    const mockProve = () => {
        witnessMock.mockReset().mockResolvedValue({
            input: { x: 1 },
            cm: [11n, 12n, 13n],
            newMerkleRoot: 21n,
            nf: [31n, 32n],
        })
        proofMock.mockReset().mockResolvedValue({
            proof: { a: {}, b: {}, c: {} },
            publicSignals: ['1', '2'],
        })
        walkMock.mockReset().mockReturnValue({
            nullSetRootBefore: 'ab'.repeat(32),
            finalNullRoot: 'cd'.repeat(32),
            sibsA: [], sibsB: [], midRoot: 'ef'.repeat(32),
        })
        produceMock.mockReset().mockReturnValue({
            unlockings: [new Uint8Array(10), new Uint8Array(10), new Uint8Array(10)],
            walkUnlockings: [new Uint8Array(10), new Uint8Array(10)],
        })
        holdingsMock.mockReset().mockReturnValue({ lockingHex: POOL.program.hLockingHex, script: new Uint8Array(211) })
        hUnlockingMock.mockReset().mockReturnValue(new Uint8Array(213))
        submitMock.mockReset().mockResolvedValue({ lockTxid: 'ee'.repeat(32), actionTxid: 'ff'.repeat(32), newHoldings: { amount: '1000' } })
    }

    beforeEach(async () => {
        window.localStorage.clear()

        const pinia = createPinia()
        pinia._a = {}
        pinia.use(StoreCompatPlugin)
        pinia.use(piniaPersist)
        setActivePinia(pinia)
        ensureStoreFacade(useStore())

        facade = getStoreFacade()

        facade.state.pool.notes = []
        facade.state.pool.leaves = []
        facade.state.pool.sealed = null
        facade.state.pool.scan = null
        facade.dispatch('pool/lockPool')

        facade.commit('profile/setMasterSeed', ENTROPY)
        seedWallet()

        poolsMock.mockReset().mockReturnValue([POOL])
        scanPoolMock.mockReset()
    }, 90000)

    it('the GENESIS deposit: the state comes from the DEPLOY out0; the submit gets isGenesis + no holdings; the witness binds the HELD category', async () => {
        scanPoolMock.mockResolvedValue(scanOf([]))
        mockProve()

        /* The pool UTXOs at genesis: ONLY the deploy's state (out0, the
           NFT-only 96-B commitment). */
        mockCluster(
            [{ txid: DEPLOY_TXID, tx_pos: 0, value: 10000, token_data: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: 'c0'.repeat(48) } } }],
            /* The wallet's own UTXOs: 2 blanks + funding + the HELD-asset
               supply (the user's pre-sent PUSD). */
            [
                { txid: '0b'.repeat(32), tx_pos: 0, value: 600, token_data: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: '' } } },
                { txid: '0c'.repeat(32), tx_pos: 0, value: 600, token_data: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: '' } } },
                { txid: '0d'.repeat(32), tx_pos: 0, value: 400000 },
                { txid: '0e'.repeat(32), tx_pos: 0, value: 2000, token_data: { category: POOL.heldCategory, amount: '5000' } },
            ],
        )

        await facade.dispatch('pool/submitRole2Action', { action: 'deposit', amount: '1000', poolId: POOL.id })

        const submitArgs = submitMock.mock.calls[0][0]
        expect(submitArgs.isGenesis).toBe(true)
        expect(submitArgs.holdings).toBeNull()
        /* Exercise the store's prove closure — the witness/proof/walk/produce
           mocks fire INSIDE it (the mocked orchestrator never calls prove). */
        const proofResult = await submitArgs.prove({ pool: POOL })
        expect(proofResult.hUnlocking.length).toBeGreaterThan(1)
        expect(proofResult.newBalance).toBe(1000n)
        expect(proofResult.carrier.length).toBe(201)
        /* The witness bound the HELD asset (the check-6 lesson). */
        expect(witnessMock).toHaveBeenCalled()
        expect(witnessMock.mock.calls[0][0].assetCategory).toBe(BigInt('0x' + POOL.heldCategory))
        expect(witnessMock.mock.calls[0][0].isDeposit).toBe(true)
        /* The walk data anchored at the scan's spent keys. */
        expect(walkMock).toHaveBeenCalled()
        /* The scenario fed the transaction build with the balance 0 (genesis). */
        expect(produceMock).toHaveBeenCalled()
        expect(produceMock.mock.calls[0][0].scenarioArgs.balance).toBe(0n)
    }, 90000)

    it('the STEADY transfer: the state from the tip out1; the holdings CONSTRUCTED from the tip out2; isGenesis false', async () => {
        const TIP = { txid: 'd1'.repeat(32), height: 979230, newBalance: 1000n, stateCommitment: 'c0'.repeat(96), holdingsAmount: 1000n }
        scanPoolMock.mockResolvedValue(scanOf([TIP]))
        mockProve()

        mockCluster(
            [{ txid: TIP.txid, tx_pos: 1, value: 10000, token_data: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: 'c0'.repeat(48) } } }],
            [
                { txid: '0b'.repeat(32), tx_pos: 0, value: 600, token_data: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: '' } } },
                { txid: '0c'.repeat(32), tx_pos: 0, value: 600, token_data: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: '' } } },
                { txid: '0d'.repeat(32), tx_pos: 0, value: 400000 },
            ],
        )

        await facade.dispatch('pool/submitRole2Action', { action: 'transfer', amount: '100', poolId: POOL.id })

        const submitArgs = submitMock.mock.calls[0][0]
        expect(submitArgs.isGenesis).toBe(false)
        /* The holdings line: the tip's out2, CONSTRUCTED (the H locking is a
           different scripthash — never re-queried). */
        expect(submitArgs.holdings).toEqual({ txid: TIP.txid, vout: 2, sats: 1000 })
        /* Exercise the prove closure, then assert its internals. */
        await submitArgs.prove({ pool: POOL })
        /* The transfer's witness: in-notes selected (no deposit phantom). */
        expect(witnessMock.mock.calls[0][0].isDeposit).toBe(false)
        /* The scenario's balance = the scan's validated chain (1,000). */
        expect(produceMock.mock.calls[0][0].scenarioArgs.balance).toBe(1000n)

        /* B3 — the transfer's delivery hook ran with NO mailbox configured
           (the registry mock): the outbox stays empty, the submit still
           succeeds (the delivery is a registry-gated add-on). */
        expect(facade.state.pool.outbox).toEqual([])
    }, 90000)

    it('the deposit SUPPLY reads the HELD category (the user pre-sends their PUSD to their wallet)', async () => {
        scanPoolMock.mockResolvedValue(scanOf([]))
        mockProve()

        mockCluster(
            [{ txid: DEPLOY_TXID, tx_pos: 0, value: 10000, token_data: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: 'c0'.repeat(48) } } }],
            [
                { txid: '0b'.repeat(32), tx_pos: 0, value: 600, token_data: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: '' } } },
                { txid: '0c'.repeat(32), tx_pos: 0, value: 600, token_data: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: '' } } },
                { txid: '0d'.repeat(32), tx_pos: 0, value: 400000 },
                /* the POOL-category FT (NOT the supply) + the HELD FT (the supply). */
                { txid: '0e'.repeat(32), tx_pos: 0, value: 2000, token_data: { category: POOL.assetCategory, amount: '9000000' } },
                { txid: '0f'.repeat(32), tx_pos: 0, value: 2000, token_data: { category: POOL.heldCategory, amount: '5000' } },
            ],
        )

        await facade.dispatch('pool/submitRole2Action', { action: 'deposit', amount: '1000', poolId: POOL.id })

        const submitArgs = submitMock.mock.calls[0][0]
        /* The supply is the HELD-category UTXO (0f…), never the pool-category FT. */
        expect(submitArgs.supply.txid).toBe('0f'.repeat(32))
    })
})
