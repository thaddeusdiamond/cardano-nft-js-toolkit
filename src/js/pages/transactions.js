import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";
import * as AdaPrice from "../data/ada_price.js";

import {longToast} from "../third-party/toastify-utils.js";
import {validate, validated} from "../nft-toolkit/utils.js";

import {getAddressDetails, toHex} from "lucid-cardano";

const NEWEST_BLOCK = 2147483647;  // maxint
const OLDEST_BLOCK = 1;

const HANDLE_IDENTIFIER = '$';
const HANDLE_POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
const STAKE_PREFIX = 'stake';

const RETRY_DELAY = 5000;
const RETRIES = 3;

const HISTORY_AUTH_MAP = [
  {
    policies: [
      "b000e9f3994de3226577b4d61280994e53c07948c8839d628f4a425a",
      "33568ad11f93b3e79ae8dee5ad928ded72adcea719e92108caf1521b",
    ],
    threshold: 10
  },
  {
    policies: [
      "33566617519280305e147975f80914cea1c93e8049567829f7370fca"
    ],
    threshold: 1
  }
]

const DOWNLOAD_AUTH_MAP = [
  {
    policies: [
      "b000e9f3994de3226577b4d61280994e53c07948c8839d628f4a425a",
      "33568ad11f93b3e79ae8dee5ad928ded72adcea719e92108caf1521b",
    ],
    threshold: 10
  },
  {
    policies: [
      "33566617519280305e147975f80914cea1c93e8049567829f7370fca"
    ],
    threshold: 1
  }
]

const MARKETPLACES = [
  'stake1uxqh9rn76n8nynsnyvf4ulndjv0srcc8jtvumut3989cqmgjt49h6',
  'addr1w999n67e86jn6xal07pzxtrmqynspgx0fwmcmpua4wc6yzsxpljz3',
  'addr1w9yr0zr530tp9yzrhly8lw5upddu0eym3yh0mjwa0qlr9pgmkzgv0',
  'addr1w89s3lfv7gkugker5llecq6x3k2vjvfnvp4692laeqe6w6s93vj3j',
  'addr1wywukn5q6lxsa5uymffh2esuk8s8fel7a0tna63rdntgrysv0f3ms',
  'addr1wxx0w0ku3jz8hz5dakg982lh22xx6q7z2z7vh0dt34uzghqrxdhqq',
  'addr1wx38kptjhuurcag7zdvh5cq98rjxt0ulf6ed7jtmz5gpkfcgjyyx3',
  'addr1wxz62xuzeujtuuzn2ewkrzwmm2pf79kfc84lrnjsd9ja2jscv3gy0',
  'addr1wyl5fauf4m4thqze74kvxk8efcj4n7qjx005v33ympj7uwsscprfk'
];

const TXN_COLUMN_HEADERS = [
  'transaction hash',
  'datetime',
  'unixtime',
  'type',
  'stake address',
  'net amount',
  'cryptocurrency',
  'conversion rate',
  'conversion symbol',
  'user assets',
  'total minted',
  'assets exchanged'
]

async function callBlockfrost(endpoint, blockfrostKey) {
  const blockfrostSettings = await LucidInst.getBlockfrostParams(blockfrostKey);
  var mostRecentError = undefined;
  for (var i = 0; i < RETRIES; i++) {
    try {
      let result = await fetch(`${blockfrostSettings.api}/${endpoint}`,
        { headers: { project_id: blockfrostKey } }
      ).then(res => res.json());
      if (result && result.error) {
        throw result;
      }
      return result;
    } catch (err) {
      mostRecentError = err;
      await (new Promise(resolveFunc => setTimeout(resolveFunc, RETRY_DELAY)));
    }
  }
  throw `Unrecoverable Blockfrost error: ${mostRecentError}`;
}

async function* callPaginatedBlockfrost(endpoint, paramsString, blockfrostKey) {
  var page = 1;
  while (true) {
    const results = await callBlockfrost(`${endpoint}?page=${page}&${paramsString}`, blockfrostKey);
    if (results.length === 0) {
      break;
    }
    for (const result of results) {
      yield result;
    }
    page++;
  }
}

async function locationOfHandle(handle, blockfrostApiKey) {
  const handleHex = toHex(new TextEncoder('UTF-8').encode(handle.toLowerCase().slice(HANDLE_IDENTIFIER.length)));
  const handleAddresses = await callBlockfrost(`assets/${HANDLE_POLICY}${handleHex}/addresses`, blockfrostApiKey);
  validate(handleAddresses.length === 1, 'Invalid state: handle found at multiple locations');
  return handleAddresses[0].address;
}

async function determineAccountOf(walletAddr, blockfrostApiKey) {
  if (walletAddr.startsWith(STAKE_PREFIX)) {
    return walletAddr;
  }
  const lucid = await LucidInst.getLucidInstance(blockfrostApiKey);
  const normalizedAddress = (walletAddr.startsWith(HANDLE_IDENTIFIER)) ? (await locationOfHandle(walletAddr, blockfrostApiKey)) : walletAddr;
  const addrDetails = getAddressDetails(normalizedAddress);
  if (addrDetails.stakeCredential === undefined) {
    return undefined;
  }
  return lucid.utils.credentialToRewardAddress(addrDetails.stakeCredential);
}

async function getBlockFor(unixTime, lucid, blockfrostApiKey) {
  if (!unixTime) {
    return undefined;
  }
  const slot = lucid.utils.unixTimeToSlot(unixTime);
  return await callBlockfrost(`blocks/slot/${slot}`, blockfrostApiKey).height;
}

export async function getHistoryOf(walletAddr, blockfrostApiKey, startTime, endTime, txnCallbackFunc) {
  try {
    validate(walletAddr, 'Please enter a wallet handle before clicking "Load"');
    const lucid = await getAuthorizedLucid(blockfrostApiKey, HISTORY_AUTH_MAP);
    const startTimeBlock = OLDEST_BLOCK; //(await getBlockFor(startTime, lucid, blockfrostApiKey)) || OLDEST_BLOCK;
    const endTimeBlock = NEWEST_BLOCK; //(await getBlockFor(endTime, lucid, blockfrostApiKey)) || NEWEST_BLOCK;
    const stakeAddress = validated(await determineAccountOf(walletAddr, blockfrostApiKey), 'Unstaked addresses are currently unsupported');
    const associatedAddresses = await callPaginatedBlockfrost(`accounts/${stakeAddress}/addresses`, '', blockfrostApiKey);
    for await (const address of associatedAddresses) {
      const params = ['order=desc', `from=${startTimeBlock}`, `to=${endTimeBlock}`].join('&')
      const transactions = await callPaginatedBlockfrost(`addresses/${address.address}/transactions`, params, blockfrostApiKey);
      for await (const transaction of transactions) {
        const blockUnixTime = transaction.block_time * 1000;
        if ((startTime && startTime > blockUnixTime) || (endTime && endTime < blockUnixTime)) {
          continue;
        }
        const transactionAmounts = await callBlockfrost(`txs/${transaction.tx_hash}/utxos`, blockfrostApiKey);
        await txnCallbackFunc(transaction, transactionAmounts, stakeAddress);
      }
    }
  } catch (err) {
    longToast(err);
  }
}

async function getAuthorizedLucid(blockfrostApiKey, authorizationOptions) {
  const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
  validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before retrieving transactions using "Connect Wallet" button');

  const lucid = await LucidInst.getLucidInstance(blockfrostApiKey);
  validate(lucid, 'Your blockfrost key does not match the network of your wallet.');

  for (const authorizationOption of authorizationOptions) {
    var totalAssets = 0n;
    for (const policy of authorizationOption.policies) {
      totalAssets += await cardanoDApp.numPolicyAssets(policy);
    }
    if (totalAssets >= authorizationOption.threshold) {
      return lucid;
    }
  }
  validate(false, 'You do not have enough Wild Tangz + Clumsy Ghosts required to use this software, please read the docs, purchase and try again.');
}

async function updateNetAmountsFor(netAmounts, utxo, modifier, blockfrostApiKey) {
  const stakeKey = await determineAccountOf(utxo.address, blockfrostApiKey);
  const walletCred = (stakeKey === undefined) ? utxo.address : stakeKey;
  if (!(walletCred in netAmounts)) {
    netAmounts[walletCred] = {};
  }
  for (const amount of utxo.amount) {
    if (!(amount.unit in netAmounts[walletCred])) {
      netAmounts[walletCred][amount.unit] = 0;
    }
    netAmounts[walletCred][amount.unit] += modifier * amount.quantity;
  }
}

export async function calculateNetAmounts(transactionAmounts, blockfrostApiKey) {
  const netAmounts = {};
  for (const input of transactionAmounts.inputs) {
    if (input.reference || input.collateral) {
      continue;
    }
    await updateNetAmountsFor(netAmounts, input, -1, blockfrostApiKey);
  }
  for (const output of transactionAmounts.outputs) {
    if (output.collateral) {
      continue;
    }
    await updateNetAmountsFor(netAmounts, output, +1, blockfrostApiKey);
  }
  return zeroAssetsFiltered(netAmounts);
}

function zeroAssetsFiltered(assets) {
  const filteredAssets = {}
  for (const wallet in assets) {
    filteredAssets[wallet] = {};
    const walletAssets = assets[wallet];
    const nonZeroAssets = Object.keys(walletAssets).filter(asset => (walletAssets[asset] !== 0));
    for (const asset of nonZeroAssets) {
      filteredAssets[wallet][asset] = walletAssets[asset];
    }
  }
  return filteredAssets;
}

export async function retrieveDailyHighs(crypto, currency, marketplace) {
  validate(crypto === 'ada' && currency === 'usd' && marketplace === 'coinbase', 'Only USD values for historical ADA price supported');
  return AdaPrice.COINBASE_HISTORICAL_DATA.data;
}

export function assetsCreated(netAmounts) {
  const assetsCreatedRaw = {};
  for (const netAmount of Object.values(netAmounts)) {
    for (const unit in netAmount) {
      if (unit === 'lovelace') {
        continue;
      }
      if (!(unit in assetsCreatedRaw)) {
        assetsCreatedRaw[unit] = 0;
      }
      assetsCreatedRaw[unit] += netAmount[unit];
    }
  }
  return zeroAssetsFiltered({ minted: assetsCreatedRaw }).minted;
}

export function categorizeTransactionType(netAmounts, userWallet, assetsCreated) {
  const assetsInvolved = Object.values(netAmounts).map(netAmount => (Object.keys(netAmount).length !== 1)).reduce((acc, val) => acc || val, false);
  const assetsMinted = (Object.keys(assetsCreated).length !== 0);
  const userInvolvedInAssets = (Object.keys(netAmounts[userWallet]).length > 1);
  const marketplacesInvolved = Object.keys(netAmounts).filter(wallet => MARKETPLACES.includes(wallet));
  const netAdaReceived = netAmounts[userWallet].lovelace > 0;
  const otherWalletsInvolved = (Object.keys(netAmounts).length > 1);
  if (assetsMinted) {
    if (otherWalletsInvolved) {
      if (userInvolvedInAssets) {
        return 'Mint Faucet Receipt';
      } else {
        return 'Mint To Someone Else';
      }
    } else {
      return 'Mint To Self';
    }
  } else if (!assetsInvolved) {
    if (marketplacesInvolved.length > 0) {
      if (netAmounts[marketplacesInvolved[0]].lovelace > 0) {
        return 'Marketplace Offer';
      } else {
        return 'Marketplace Offer Withdrawal';
      }
    } else if (!otherWalletsInvolved) {
      return 'Send-To-Self (Possibly Marketplace Update)';
    } else if (netAdaReceived) {
      return 'Simple Receiving';
    } else {
      return 'Simple Sending';
    }
  } else if (marketplacesInvolved.length > 0) {
    if (netAmounts[marketplacesInvolved[0]].lovelace > 0) {
      return 'Marketplace Listing';
    } else if (userInvolvedInAssets) {
      return 'Marketplace Purchase';
    } else {
      return 'Marketplace Sale';
    }
  }
  return 'Unknown';
}

export async function downloadAsCsv(blockfrostApiKey, csvValues) {
  try {
    const lucid = await getAuthorizedLucid(blockfrostApiKey, HISTORY_AUTH_MAP);
    return `${TXN_COLUMN_HEADERS.join(',')}\n${csvValues.join('\n')}`;
  } catch (err) {
    longToast(err);
  }
}
