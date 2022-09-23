import * as CardanoDApp from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";

import {shortToast, longToast} from "../third-party/toastify-utils.js";
import {validate} from "../nft-toolkit/utils.js";

const MINT_COUNT_DOM = "#mint-count";

function updateMintCount(count, lowerLimit, upperLimit) {
  var boundedCount = Math.max(lowerLimit, Math.min(upperLimit, count));
  if (isNaN(boundedCount)) {
    boundedCount = lowerLimit;
  }
  document.querySelector(MINT_COUNT_DOM).value = boundedCount;
}

function getCurrentCount() {
  return parseInt(document.querySelector(MINT_COUNT_DOM).value);
}

export function decreaseMintCount(lowerLimit, upperLimit) {
  updateMintCount(getCurrentCount() - 1, lowerLimit, upperLimit);
}

export function increaseMintCount(lowerLimit, upperLimit) {
  updateMintCount(getCurrentCount() + 1, lowerLimit, upperLimit);
}

export function validateMintCount(lowerLimit, upperLimit) {
  updateMintCount(getCurrentCount(), lowerLimit, upperLimit);
}

async function getWhitelistedAssets(whitelistPolicies, exclusions, lucid) {
  if (whitelistPolicies === undefined || whitelistPolicies === []) {
    return {};
  }
  const whitelistedAssets = {};
  const utxos = [];
  for (const utxo of await lucid.wallet.getUtxos()) {
    var found = false;
    for (const assetName in utxo.assets) {
      if (!whitelistPolicies.includes(assetName.slice(0, 56))) {
        continue;
      }
      if (exclusions.includes(assetName)) {
        continue;
      }
      if (whitelistedAssets[assetName] === undefined) {
        whitelistedAssets[assetName] = 0n;
      }
      whitelistedAssets[assetName] += utxo.assets[assetName];
      found = true;
    }
    if (found) {
      utxos.push(utxo);
    }
  }
  return { assets: whitelistedAssets, utxos: utxos };
}

export async function whitelistAssetsAvailable(blockfrostKey, whitelistPolicies, exclusions) {
  const whitelistedAssets = await walletWhitelistedAssets(blockfrostKey, whitelistPolicies, exclusions);
  if (whitelistedAssets.assets) {
    const remainingWhitelistBigInt =
      Object.values(whitelistedAssets.assets)
            .reduce((partialSum, a) => partialSum + a, 0n);
    return Number(remainingWhitelistBigInt);
  }
  return -1;
}

export async function walletWhitelistedAssets(blockfrostKey, whitelistPolicies, exclusions) {
  var cardanoDApp = CardanoDApp.getCardanoDAppInstance();
  if (!cardanoDApp.isWalletConnected()) {
    return {};
  }

  const wallet = await cardanoDApp.getConnectedWallet();
  const lucidInst = LucidInst.getLucidInstance(blockfrostKey);
  if (!lucidInst) {
    shortToast('Unable to initialize Lucid, network mismatch detected');
    return;
  }

  try {
    const lucid = await lucidInst;
    lucid.selectWallet(wallet);
    return await getWhitelistedAssets(whitelistPolicies, exclusions, lucid);
  } catch (err) {
    const msg = (typeof(err) === 'string') ? err : JSON.stringify(err);
    shortToast(`Whitelist retrieval error occurred: ${msg}`);
  }
}

export async function mintNow(blockfrostKey, paymentAddr, price, whitelistPolicies, exclusions) {
  var cardanoDApp = CardanoDApp.getCardanoDAppInstance();
  if (!cardanoDApp.isWalletConnected()) {
    shortToast('Please connect a wallet before minting using "Connect Wallet" button (desktop only)');
    return;
  }

  const wallet = await cardanoDApp.getConnectedWallet();
  const lucidInst = LucidInst.getLucidInstance(blockfrostKey);
  if (!lucidInst) {
    shortToast('Unable to initialize Lucid, network mismatch detected');
    return;
  }

  try {
    const lucid = await lucidInst;
    lucid.selectWallet(wallet);
    const walletAddress = await lucid.wallet.address();

    var paymentAmount = getCurrentCount() * price;
    validate(paymentAmount > 0, "Must mint at least 1 NFT at a time");
    var txBuilder = lucid.newTx().payToAddress(paymentAddr, { lovelace: paymentAmount });

    const whitelistedAssets = await getWhitelistedAssets(whitelistPolicies, exclusions, lucid);
    if (whitelistedAssets.assets !== undefined) {
      txBuilder = txBuilder.payToAddress(walletAddress, whitelistedAssets.assets);
    }

    const txComplete = await txBuilder.complete();
    const txSigned = await txComplete.sign().complete();
    const txHash = await txSigned.submit();
    shortToast(`Successfully sent money for minting in tx: ${txHash}`);
  } catch (err) {
    const msg = (typeof(err) === 'string') ? err : JSON.stringify(err);
    shortToast(`Transaction error occurred: ${msg}`);
  }
}
