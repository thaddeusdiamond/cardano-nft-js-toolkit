import * as LucidInst from "../third-party/lucid-inst.js";

import {longToast} from "../third-party/toastify-utils.js";

import {getAddressDetails} from "lucid-cardano";

const RETRIES = 3;
const STAKE_PREFIX = 'stake';

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
    }
  }
  throw mostRecentError;
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

async function determineAccountOf(walletAddr, blockfrostApiKey) {
  if (walletAddr.startsWith(STAKE_PREFIX)) {
    return walletAddr;
  }
  const lucid = await LucidInst.getLucidInstance(blockfrostApiKey);
  const addrDetails = getAddressDetails(walletAddr);
  if (addrDetails.stakeCredential === undefined) {
    return undefined;
  }
  return lucid.utils.credentialToRewardAddress(addrDetails.stakeCredential);
}

export async function getHistoryOf(walletAddr, blockfrostApiKey, txnCallbackFunc) {
  const stakeAddress = await determineAccountOf(walletAddr, blockfrostApiKey);
  if (stakeAddress === undefined) {
    longToast('Unstaked addresses are currently unsupported');
  }
  const associatedAddresses = callPaginatedBlockfrost(`accounts/${stakeAddress}/addresses`, '', blockfrostApiKey);
  for await (const address of associatedAddresses) {
    const transactions = callPaginatedBlockfrost(`addresses/${address.address}/transactions`, 'order=desc', blockfrostApiKey);
    for await (const transaction of transactions) {
      const transactionAmounts = await callBlockfrost(`txs/${transaction.tx_hash}/utxos`, blockfrostApiKey);
      await txnCallbackFunc(transaction, transactionAmounts);
    }
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
    await updateNetAmountsFor(netAmounts, input, -1, blockfrostApiKey);
  }
  for (const output of transactionAmounts.outputs) {
    await updateNetAmountsFor(netAmounts, output, +1, blockfrostApiKey);
  }
  return netAmounts;
}
