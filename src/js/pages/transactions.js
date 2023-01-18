import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";

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

const AUTHORIZATION_MINS = {
    "b000e9f3994de3226577b4d61280994e53c07948c8839d628f4a425a" : 3,
    "33568ad11f93b3e79ae8dee5ad928ded72adcea719e92108caf1521b" : 3,
    "33566617519280305e147975f80914cea1c93e8049567829f7370fca" : 1
}

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

    const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before retrieving transactions using "Connect Wallet" button');

    const lucid = await LucidInst.getLucidInstance(blockfrostApiKey);
    validate(lucid, 'Your blockfrost key does not match the network of your wallet.');

    const startTimeBlock = OLDEST_BLOCK; //(await getBlockFor(startTime, lucid, blockfrostApiKey)) || OLDEST_BLOCK;
    const endTimeBlock = NEWEST_BLOCK; //(await getBlockFor(endTime, lucid, blockfrostApiKey)) || NEWEST_BLOCK;

    validate(await cardanoDApp.walletMeetsTokenGate(AUTHORIZATION_MINS), 'At least 3 Wild Tangz or 1 Buffoon is required to use this software, please purchase and try again.');

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
  return netAmounts;
}

export async function retrieveDailyHighs(crypto, currency, marketplace) {
  // TODO: Change this to a proxy server
  //return await fetch(`https://api.cryptowat.ch/markets/${marketplace}/${crypto}${currency}/ohlc`);
  return {}
}
