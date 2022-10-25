import {fromHex} from "lucid-cardano";

import {cardanoDAppWallet, connectedLucidInst, executeCborTxn, getWalletInfo, validateHoldings} from "../pages/sweep.js";

import {validate, validated} from "../nft-toolkit/utils.js";
import {shortToast} from "../third-party/toastify-utils.js";

const REQUIRED_POLICY_KEY = '33568ad11f93b3e79ae8dee5ad928ded72adcea719e92108caf1521b';
const REQUIRED_POLICY_MIN = 4;
const FEE_ADDR = 'addr1qyqnxg39d5258mhu6739y0c69h38zzzc8q6t2vknlhvssv5xmxx6g6njmjphu2rq7yxhygnygynqga74mnp776jvgsqsmxx684';

const LOVELACE_TO_ADA = 1000000;
const MIN_LISTING_PRICE = 5;

const API_BASE = "https://server.jpgstoreapis.com";
const IPFS_BASE = 'https://ipfs.jpgstoreapis.com';
const LIST_NONCE_LEN = 16;
const LOVELACE_LIST_AMT = 5 * LOVELACE_TO_ADA;
const ONE_DAY_SEC = 86400;

const ERROR_ICON = "https://sweep.wildtangz.pages.dev/error-med.png";
const PROGRESS_ICON = "https://c.tenor.com/w5DF_eXs5S4AAAAC/cardano-logo.gif";
const SUCCESS_ICON = "https://sweep.wildtangz.pages.dev/success-med.png";

const TX_HASH_LENGTH = 64;

const MAX_WAIT_ATTEMPTS = 12;
const UTXO_WAIT_TIMEOUT = 30000;

export function hideAlertBox() {
  document.getElementById('wt-list-status').style.display = 'none';
}

function showAlertBox() {
  document.getElementById('wt-list-status-close').style.display = 'none';
  document.getElementById('wt-list-status').style.display = 'flex';
}

function showCloseOption() {
  document.getElementById('wt-list-status-close').style.display = '';
}

function updateAlertBox(msg, icon) {
  const currMsg = document.getElementById('wt-list-status-msg').textContent;
  document.getElementById('wt-list-status-prior').textContent = `Previous: ${currMsg}`;
  document.getElementById('wt-list-status-msg').textContent = msg;
  document.getElementById('wt-list-status-icon').src = icon;
}

function updateProgress(msg) {
  updateAlertBox(msg, PROGRESS_ICON);
}

function updateError(msg) {
  updateAlertBox(msg, ERROR_ICON);
}

function updateSuccess(msg) {
  updateAlertBox(msg, SUCCESS_ICON);
}

async function validateHoldingsBeforeList(blockfrostKey) {
  const wallet = await cardanoDAppWallet();
  const lucid = await connectedLucidInst(blockfrostKey, wallet);
  await validateHoldings(lucid, REQUIRED_POLICY_KEY, REQUIRED_POLICY_MIN);
}

async function completeAndSignTxn(txBuilder) {
  const txComplete = await txBuilder.complete();
  const txSigned = await txComplete.sign().complete();
  const txHash = await txSigned.submit();
  if (txHash.length !== TX_HASH_LENGTH) {
    throw txHash;
  }

  return txHash;
}

async function performSendToSelf(blockfrostKey, listings) {
  const wallet = await cardanoDAppWallet();
  const lucid = await connectedLucidInst(blockfrostKey, wallet);

  const listerAddress = await lucid.wallet.address();
  const txBuilder = lucid.newTx();
  for (const listing of listings) {
    txBuilder.payToAddress(listerAddress, {
      lovelace: LOVELACE_LIST_AMT,
      [listing.id]: listing.quantity
    });
  }

  return await completeAndSignTxn(txBuilder);
}

async function performFeeTxn(blockfrostKey, adaFee) {
  const wallet = await cardanoDAppWallet();
  const lucid = await connectedLucidInst(blockfrostKey, wallet);

  const lovelaceFee = adaFee * LOVELACE_TO_ADA;
  const txBuilder = lucid.newTx().payToAddress(FEE_ADDR, {lovelace: lovelaceFee});
  return await completeAndSignTxn(txBuilder);
}

function generateNonce(size) {
  return [...Array(size)].map(() =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

async function buildListTxn(assetId, priceAda, address, stakeAddress, collateralUtxo, listingUtxo) {
  const tracingId = `${stakeAddress}-${new Date().toISOString()}-${generateNonce(LIST_NONCE_LEN)}`;
  const priceLovelace = (priceAda * LOVELACE_TO_ADA).toString();
  const buildTxnJson = {
    collateral: [collateralUtxo],
    utxos: [listingUtxo],
    address: address,
    action: "SELL",
    assetId: assetId,
    priceLovelace: priceLovelace,
    duration: ONE_DAY_SEC,
    offerTxHash: null,
    tracingId: tracingId
  };

  const listingTxn = await fetch(`${API_BASE}/transaction/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildTxnJson)
  }).then(res => res.json());
  return listingTxn;
}

export async function waitForTxn(blockfrostKey, txHash) {
  for (var i = 0; i < MAX_WAIT_ATTEMPTS; i++) {
    const wallet = await cardanoDAppWallet();
    const lucid = await connectedLucidInst(blockfrostKey, wallet);
    const walletInfo = await getWalletInfo(wallet, lucid);
    for (const utxo of walletInfo.utxos.values()) {
      if (utxo.txHash === txHash) {
        return;
      }
    }
    await new Promise(resolveFunc => setTimeout(resolveFunc, UTXO_WAIT_TIMEOUT));
  }
  throw `Could not find results for transaction ${txHash} after ${MAX_WAIT_ATTEMPTS} attempts`;
}

function findAssetUtxo(assetId, listingName, walletInfo, txHash) {
  const listingUtxos = [...walletInfo.utxos].filter(([utxo, utxoCore]) => (utxoCore.txHash === txHash) && (utxoCore.assets[assetId] === 1n));
  validate(listingUtxos.length == 1, `Found incorrect number of holdings for ${listingName} (${listingUtxos.length})`);
  return listingUtxos[0][0];
}

export async function performList(blockfrostKey) {
  const listingsChecked = document.querySelectorAll('input[class=wt-list-checkbox]:checked');
  if (listingsChecked.length == 0) {
    shortToast('Please select items to list!');
    return;
  }

  showAlertBox();

  var successfulListings = 0;
  try {
    var listings = [];
    for (const listingCheck of listingsChecked) {
      const listingDom = listingCheck.parentNode.parentNode;
      const assetId = listingDom.getAttribute('data-id');
      const quantity = listingDom.getAttribute('data-qty');
      const priceAda = Number(listingDom.querySelector('.wt-list-price').value);
      const name = listingDom.querySelector('.wt-list-name').textContent;
      validate(priceAda > MIN_LISTING_PRICE, `${name} listing price must be greater than ${MIN_LISTING_PRICE}₳`);
      listings.push({ id: assetId, priceAda: priceAda, name: name, quantity: quantity });
    }

    updateProgress('Validating your Wild Tangz holdings...');
    await validateHoldingsBeforeList(blockfrostKey);

    updateProgress('Retrieving information to split up your UTxOs for listing...');
    const sendToSelfTx = await performSendToSelf(blockfrostKey, listings);
    updateProgress(`Successfully split UTxOs.  Now waiting for transaction to register (BE PATIENT this may take several minutes) [txn ${sendToSelfTx}]...`);
    await waitForTxn(blockfrostKey, sendToSelfTx);

    const fee = listings.length;
    updateProgress(`Collecting fee of ${fee}₳ (1₳ per NFT)...`);
    await performFeeTxn(blockfrostKey, fee);
    updateProgress(`Collected fee of ${fee}₳ (thank you!)`);

    const wallet = await cardanoDAppWallet();
    const lucid = await connectedLucidInst(blockfrostKey, wallet);
    const walletInfo = await getWalletInfo(wallet, lucid);
    const collateralUtxo = validated(walletInfo.collateral?.flat()[0], 'Wallet does not have any collateral set');

    for (var i = 0; i < listings.length; i++) {
      const listing = listings[i];
      try {
        updateProgress(`[${i + 1} / ${listings.length}] Attempting to list ${listing.name} for ${listing.priceAda}₳...`);
        const assetId = listing.id;
        const listingUtxo = findAssetUtxo(assetId, listing.name, walletInfo, sendToSelfTx);
        const listTxnBuild = await buildListTxn(assetId, listing.priceAda, walletInfo.address, walletInfo.stakeAddress, collateralUtxo, listingUtxo);
        const listTxn = await executeCborTxn(lucid, {txn: listTxnBuild});
        updateSuccess(`[${i + 1} / ${listings.length}] Successfully listed ${listing.name} for ${listing.priceAda}₳! (tx: ${listTxn.txHash})`);
        successfulListings++;
      } catch (err) {
        const msg = typeof(err) === 'string' ? err : JSON.stringify(err, Object.getOwnPropertyNames(err));
        updateError(msg);
        if (!confirm(`An error occurred listing ${listing.name}, continue?`)) {
          throw err;
        }
      }
    }

    updateSuccess(`Listed ${successfulListings} successfully out of ${listings.length} selected!`);
  } catch (err) {
    const msg = typeof(err) === 'string' ? err : JSON.stringify(err, Object.getOwnPropertyNames(err));
    updateError(msg);
  } finally {
    showCloseOption();
    if (successfulListings > 0) {
      loadWallet(blockfrostKey);
    }
  }
}

function getCollectionDom() {
  const collectionDom = document.createElement('div');
  collectionDom.className = 'sqs-row';
  return collectionDom;
}

function getCollectionHeaderDom(collection, floorPrice) {
  const headerDom = document.createElement('div');
  headerDom.innerHTML = `<h4 class="wt-list-collection-header">${collection} <em>(floor: ${floorPrice ? floorPrice : '--'}₳)</em></h4>`;
  return headerDom;
}

function getAssetDom(asset) {
  const assetDom = document.createElement('div');
  assetDom.innerHTML = `
    <div class="wt-list-card sqs-col-2" data-id="${asset.id}" data-qty="${asset.quantity}">
      <div class="wt-list-image">
        <img src="${IPFS_BASE}/${asset.source}" width="100%" loading="lazy" />
      </div>
      <div class="wt-list-info">
        <h4 class="wt-list-name">${asset.name}</h4>
        <p class="wt-list-policy">${asset.collection}</p>
        <input class="wt-list-checkbox" type="checkbox" />
        <input class="wt-list-price" type="number" placeholder="List Price (₳)" />
      </div>
    </div>`;
  return assetDom;
}

async function getWalletNfts(address) {
  const walletData = await fetch(`https://server.jpgstoreapis.com/user/${address}/data`).then(res => res.json());
  return walletData;
}

async function loadWallet(blockfrostKey) {
  document.getElementById('wt-list-connect').style.display = 'none';
  document.getElementById('wt-list-loading').style.display = 'block';
  document.getElementById('wt-list-wallet').innerHTML = '';
  try {
    const wallet = await cardanoDAppWallet();
    const lucid = await connectedLucidInst(blockfrostKey, wallet);
    const listerAddress = await lucid.wallet.address();
    const walletNfts = await getWalletNfts(listerAddress);

    const collections = {};
    const floorPrices = {};
    for (const token of walletNfts.tokens) {
      const quantity = Number(token.quantity);
      if (quantity != 1) {
        continue;
      }
      const assetId = token.asset_id;
      const assetName = token.display_name;
      const policy = token.policy_id;
      const collectionName = token.collections?.display_name;
      const source = token.source;
      if (!(collectionName in collections)) {
        collections[collectionName] = {}
      }
      if (token.collections?.jpg_floor_lovelace !== undefined) {
        floorPrices[collectionName] = Number(token.collections?.jpg_floor_lovelace) / LOVELACE_TO_ADA;
      }
      collections[collectionName][assetId] = {
        id: assetId,
        name: assetName,
        policy: policy,
        collection: collectionName,
        quantity: quantity,
        source: source
      };
    }

    const collectionNames = Object.keys(collections).sort();
    for (const collection of collectionNames) {
      const collectionDom = getCollectionDom();
      document.getElementById('wt-list-wallet').appendChild(collectionDom);
      const collectionHeader = getCollectionHeaderDom(collection, floorPrices[collection]);
      collectionDom.appendChild(collectionHeader);
      for (const assetId in collections[collection]) {
        const asset = collections[collection][assetId];
        const assetDom = getAssetDom(asset);
        collectionDom.appendChild(assetDom);
      }
    }
  } catch (err) {
    shortToast(`There was an error loading your wallet, please contact the developers: ${err}`);
  } finally {
    document.getElementById('wt-list-loading').style.display = 'none';
  }
}

export async function processMessageData(message, blockfrostKey) {
  switch (message.type) {
    case "CARDANO_DAPP_JS_CONNECT":
      await loadWallet(blockfrostKey);
    default:
      //console.log(`Received unknown message of type ${message.type}: ${message.text}`);
      return;
  }
}
