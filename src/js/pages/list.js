import {fromHex, toHex} from "lucid-cardano";

import {cardanoDAppWallet, connectedLucidInst, executeCborTxn, getWalletInfo, validateHoldings} from "../pages/sweep.js";

import {validate, validated} from "../nft-toolkit/utils.js";
import {shortToast} from "../third-party/toastify-utils.js";

const REQUIRED_POLICY_KEY = '33568ad11f93b3e79ae8dee5ad928ded72adcea719e92108caf1521b';
const REQUIRED_POLICY_MIN = 4;
const FEE_ADDR = 'addr1qyqnxg39d5258mhu6739y0c69h38zzzc8q6t2vknlhvssv5xmxx6g6njmjphu2rq7yxhygnygynqga74mnp776jvgsqsmxx684';

const LOVELACE_TO_ADA = 1000000;
const MIN_LISTING_PRICE = 5;
const PRICE_PER_NFT = 1;

const API_BASE = "https://server.jpgstoreapis.com";
const IPFS_BASE = 'https://ipfs.jpgstoreapis.com';
const LIST_NONCE_LEN = 16;
const LOVELACE_LIST_AMT = 5 * LOVELACE_TO_ADA;
const NONE = 0;
const ONE_DAY_SEC = 86400;
const ONE_MIN_MS = 60000;

const ERROR_ICON = "https://sweep.wildtangz.pages.dev/error-med.png";
const PROGRESS_ICON = "https://c.tenor.com/w5DF_eXs5S4AAAAC/cardano-logo.gif";
const SUCCESS_ICON = "https://sweep.wildtangz.pages.dev/success-med.png";

const TX_HASH_LENGTH = 64;

const MAX_WAIT_ATTEMPTS = 12;
const UTXO_WAIT_TIMEOUT = 30000;

const OWNED = 'owned';
const LISTED = 'listed';

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
    var sendToSelfAssets = { lovelace: LOVELACE_LIST_AMT }
    if (listing.quantity > 0) {
      sendToSelfAssets[listing.id] = listing.quantity;
    }
    txBuilder.payToAddress(listerAddress, sendToSelfAssets);
  }

  return await completeAndSignTxn(txBuilder);
}

async function performFeeTxn(blockfrostKey, feeAda) {
  const wallet = await cardanoDAppWallet();
  const lucid = await connectedLucidInst(blockfrostKey, wallet);
  const txBuilder = lucid.newTx().payToAddress(FEE_ADDR, {lovelace: feeAda * LOVELACE_TO_ADA});
  return await completeAndSignTxn(txBuilder);
}

function generateNonce(size) {
  return [...Array(size)].map(() =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

async function submitToJpgStore(bodyJson, endpoint) {
  return await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyJson)
  }).then(res => res.json());
}

async function buildJpgStoreTxn(buildTxnJson) {
  return await submitToJpgStore(buildTxnJson, 'transaction/build');
}

async function buildListTxn(assetId, priceAda, address, collateralUtxo, listingUtxo, tracingId) {
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

  return await buildJpgStoreTxn(buildTxnJson);
}

async function buildDelistTxn(address, listingId, collateralUtxo, listingUtxo, tracingId) {
  const buildTxnJson = {
    collateral: [collateralUtxo],
    utxos: [listingUtxo],
    address: address,
    action: "DELIST",
    listingId: listingId,
    tracingId: tracingId
  };

  return await buildJpgStoreTxn(buildTxnJson);
}

async function buildTxn(assetId, listing, address, tracingId, collateralUtxo, listingUtxo) {
  if (listing.type === OWNED) {
    return await buildListTxn(assetId, listing.priceAda, address, collateralUtxo, listingUtxo, tracingId);
  } else if (listing.type === LISTED) {
    return await buildDelistTxn(address, listing.listingId, collateralUtxo, listingUtxo, tracingId);
  }
  throw `Unrecognized transaction type ${listing.type}`;
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

function findAssetUtxo(assetId, quantity, listingName, walletInfo, txHash, exclusions) {
  for (const utxoStr of walletInfo.utxos.keys()) {
    const utxo = walletInfo.utxos.get(utxoStr);
    if (utxo.txHash !== txHash) {
      continue;
    }
    if (exclusions.contains(utxo.outputIndex)) {
      continue;
    }
    if (quantity === 0 || (utxo.assets[assetId] >= quantity)) {
      return [utxoStr, utxo];
    }
  }
  throw `Could not find ${listingName} (txn ${txHash}, exclusions ${exclusions})`;
}

function postTxnAsync(assetId, txn, tracingId) {
  setTimeout(() => fetch(`${API_BASE}/token/${assetId}/heal`, {method: 'PATCH'}).then(_ => _), ONE_MIN_MS);
}

/*async function performPostTxnAsync(assetId, txn, tracingId) {
  const registerTxnJson = {
    assetId: assetId,
    txHash: txn.txHash,
    witnessSet: toHex(txn.txSigned.witness_set().to_bytes()),
    tracingId: tracingId
  };

  return await submitToJpgStore(registerTxnJson, 'transaction/register');
}*/

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
      const quantity = Number(listingDom.getAttribute('data-qty'));
      const type = listingDom.getAttribute('data-type');
      const listingId = Number(listingDom.getAttribute('data-listingId'));
      const priceAda = Number(listingDom.querySelector('.wt-list-price')?.value);
      const name = listingDom.querySelector('.wt-list-name').textContent;
      validate((type === LISTED) || (priceAda > MIN_LISTING_PRICE), `${name} listing price must be greater than ${MIN_LISTING_PRICE}₳`);
      listings.push({
        id: assetId,
        priceAda: priceAda,
        name: name,
        quantity: quantity,
        type: type,
        listingId: listingId
      });
    }

    updateProgress('Validating your Wild Tangz holdings...');
    await validateHoldingsBeforeList(blockfrostKey);

    updateProgress('Retrieving information to split up your UTxOs for listing...');
    const sendToSelfTx = await performSendToSelf(blockfrostKey, listings);
    updateProgress(`Successfully split UTxOs.  Now waiting for transaction to register (BE PATIENT this may take several minutes) [txn ${sendToSelfTx}]...`);
    await waitForTxn(blockfrostKey, sendToSelfTx);

    const fee = Math.max((listings.length * PRICE_PER_NFT), 1);
    updateProgress(`Collecting fee of ${fee}₳ (${PRICE_PER_NFT}₳ per NFT)...`);
    await performFeeTxn(blockfrostKey, fee);
    updateProgress(`Collected fee of ${fee}₳ (thank you!)`);

    const wallet = await cardanoDAppWallet();
    const lucid = await connectedLucidInst(blockfrostKey, wallet);
    const walletInfo = await getWalletInfo(wallet, lucid);
    const collateralUtxo = validated(walletInfo.collateral?.flat()[0], 'Wallet does not have any collateral set');

    var exclusions = [];
    for (var i = 0; i < listings.length; i++) {
      const listing = listings[i];
      try {
        const listingTypeMsg = (listing.type === LISTED) ? 'delist' : 'list';
        const priceTypeMsg = (listing.type === LISTED) ? '' : `for ${listing.priceAda}₳`
        updateProgress(`[${i + 1} / ${listings.length}] Attempting to ${listingTypeMsg} ${listing.name} ${priceTypeMsg}...`);
        const assetId = listing.id;
        const listingUtxoPair = findAssetUtxo(assetId, listing.quantity, listing.name, walletInfo, sendToSelfTx, exclusions);
        exclusions.push(listingUtxoPair[1].outputIndex);
        const tracingId = `${walletInfo.stakeAddress}-${new Date().toISOString()}-${generateNonce(LIST_NONCE_LEN)}`;
        const listTxnBuild = await buildTxn(assetId, listing, walletInfo.address, tracingId, collateralUtxo, listingUtxoPair[0]);
        const listTxn = await executeCborTxn(lucid, {txn: listTxnBuild});
        postTxnAsync(assetId, listTxn, tracingId);
        updateSuccess(`[${i + 1} / ${listings.length}] Successfully ${listingTypeMsg}ed ${listing.name} ${priceTypeMsg}! (tx: ${listTxn.txHash})`);
        successfulListings++;
      } catch (err) {
        const msg = typeof(err) === 'string' ? err : JSON.stringify(err, Object.getOwnPropertyNames(err));
        updateError(msg);
        if (!confirm(`An error occurred listing ${listing.name}, continue?`)) {
          throw err;
        }
      }
    }

    updateSuccess(`Listed/delisted ${successfulListings} successfully out of ${listings.length} selected!`);
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
    <div class="wt-list-card ${asset.type} sqs-col-2" data-id="${asset.id}" data-qty="${asset.quantity}" data-type="${asset.type}" data-listingId="${asset.listingId}">
      <div class="wt-list-image">
        <img src="${IPFS_BASE}/${asset.source}" width="100%" loading="lazy" />
      </div>
      <div class="wt-list-info">
        <h4 class="wt-list-name">${asset.name}</h4>
        <p class="wt-list-policy">${asset.collection}</p>
        <input class="wt-list-checkbox" type="checkbox" />
        ${asset.type === OWNED ?
            '<input class="wt-list-price" type="number" placeholder="List Price (₳)" />' :
            '<span class="wt-delist-info">Click to Delist</span>'}
      </div>
    </div>`;
  return assetDom;
}

function addToCollection(collections, floorPrices, collectionName, policy, token, quantity, assetType, listingId) {
  const assetId = token.asset_id;
  const assetName = token.display_name;
  const source = token.source;
  if (!(collectionName in collections)) {
    collections[collectionName] = {}
  }
  if (token.collections?.jpg_floor_lovelace !== undefined) {
    floorPrices[collectionName] = Number(token.collections?.jpg_floor_lovelace) / LOVELACE_TO_ADA;
  }
  collections[collectionName][assetName] = {
    id: assetId,
    name: assetName,
    policy: policy,
    collection: collectionName,
    quantity: quantity,
    source: source,
    type: assetType,
    listingId: listingId
  };
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
      const policy = token.policy_id;
      const collectionName = token.collections?.display_name;
      addToCollection(collections, floorPrices, collectionName, policy, token, quantity, OWNED);
    }

    for (const token of walletNfts.listings) {
      const policy = token.asset_id.slice(0, 56);
      const collectionName = token.collection_display_name;
      addToCollection(collections, floorPrices, collectionName, policy, token, NONE, LISTED, token.id);
    }

    const collectionNames = Object.keys(collections).sort();
    for (const collection of collectionNames) {
      const collectionDom = getCollectionDom();
      document.getElementById('wt-list-wallet').appendChild(collectionDom);
      const collectionHeader = getCollectionHeaderDom(collection, floorPrices[collection]);
      collectionDom.appendChild(collectionHeader);
      for (const assetName of Object.keys(collections[collection]).sort()) {
        const asset = collections[collection][assetName];
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
