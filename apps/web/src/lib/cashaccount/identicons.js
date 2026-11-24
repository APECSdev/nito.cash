// apps/web/src/lib/cashaccount/identicons.js
//
// The CashAccounts v2 Account Identicon table (spec section "Account
// Identicons"). 128 base Unicode code points, in the spec's order, plus the
// English one-word names the spec recommends.
//
// Source: CashAccountV2.md lines 143-330 (the ordered emoji list + the JSON
// code-point array + the English names table). The identicon index is
// `BigInt('0x' + fullCollisionHash) % 128n` — see identifier.js.

export const IDENTICON_CODE_POINTS = [
    128054, 128049, 128055, 128018, 129409, 128024, 128060, 128039, 129414,
    129417, 129413, 128056, 128034, 128013, 128044, 128051, 128031, 128025,
    129408, 128029, 129419, 128050, 129412, 127815, 127817, 127819, 127820,
    127822, 127827, 127826, 127821, 129361, 129365, 127805, 129382, 129477,
    127798, 127875, 127812, 129372, 127838, 129360, 129384, 129472, 129370,
    127828, 127839, 127829, 127836, 127843, 127849, 127850, 127874, 127851,
    129750, 127794, 127797, 127801, 127808, 127809, 9728, 127769, 11088, 129680,
    9729, 9889, 127786, 127752, 10052, 129482, 128293, 127755, 127965, 9978,
    127968, 127984, 128508, 128690, 128663, 128642, 128674, 9875, 9992, 128641,
    128640, 129681, 128368, 128161, 128444, 129529, 9730, 128273, 128274,
    128296, 9986, 129522, 9881, 9878, 128737, 128305, 9999, 128206, 128218,
    128187, 127925, 127908, 127911, 127929, 127928, 127930, 129345, 9918,
    127936, 128761, 129665, 127942, 9824, 9823, 129513, 128095, 127913, 128081,
    128141, 128142, 9995, 10084, 127880, 127937,
]

export const IDENTICON_NAMES = [
    'dog', 'cat', 'pig', 'monkey', 'lion', 'elephant', 'panda', 'penguin',
    'duck', 'owl', 'eagle', 'frog', 'turtle', 'snake', 'dolphin', 'whale',
    'fish', 'octopus', 'crab', 'bee', 'butterfly', 'dragon', 'unicorn',
    'grapes', 'watermelon', 'lemon', 'banana', 'apple', 'strawberry',
    'cherries', 'pineapple', 'avocado', 'carrot', 'corn', 'broccoli', 'onion',
    'chili', 'pumpkin', 'mushroom', 'peanut', 'bread', 'croissant', 'pretzel',
    'cheese', 'egg', 'burger', 'fries', 'pizza', 'noodles', 'sushi', 'donut',
    'cookie', 'cake', 'chocolate', 'teapot', 'tree', 'cactus', 'rose',
    'clover', 'leaf', 'sun', 'moon', 'star', 'planet', 'cloud', 'lightning',
    'tornado', 'rainbow', 'snowflake', 'ice', 'fire', 'volcano', 'island',
    'tent', 'house', 'castle', 'tower', 'bicycle', 'car', 'train', 'ship',
    'anchor', 'airplane', 'helicopter', 'rocket', 'chair', 'clock', 'bulb',
    'picture', 'broom', 'umbrella', 'key', 'lock', 'hammer', 'scissors',
    'magnet', 'gear', 'scales', 'shield', 'trident', 'pencil', 'paperclip',
    'books', 'computer', 'music', 'microphone', 'headphones', 'piano',
    'guitar', 'trumpet', 'drum', 'baseball', 'basketball', 'skateboard',
    'kite', 'trophy', 'spades', 'chess', 'puzzle', 'shoe', 'hat', 'crown',
    'ring', 'diamond', 'hand', 'heart', 'balloon', 'flag',
]
