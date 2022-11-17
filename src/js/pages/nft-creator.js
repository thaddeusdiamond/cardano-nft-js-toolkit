import {toHex, fromHex, C as LCore} from "lucid-cardano";
import mime from "mime";

import * as Secrets from "../secrets.js";

import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";
import * as NftPolicy from "../nft-toolkit/nft-policy.js";
import * as NftStorage from "../third-party/nft-storage.js";

import {shortToast, longToast} from "../third-party/toastify-utils.js";
import {validate, validated, createTextInput, createCheckboxInput} from "../nft-toolkit/utils.js";
import {RebateCalculator} from "../nft-toolkit/rebate-calculator.js";

const FILENAME_ID = 'local-file-name';
const FILETYPE_ID = 'local-file-mimetype';
const IMAGE_FIELD = 'image';
const IMAGE_MIME_PREFIX = 'image/';
const INPUT_TYPE = 'INPUT';
const IPFS_LINK_ID = 'ipfs-io-link';
const KEY_SUFFIX = 'name';
const LOVELACE = 'lovelace';
const MAX_BURN_ATTEMPTS = 10;
const METADATA_SPLITTER = new RegExp(`(.{1,${NftPolicy.NftPolicy.MAX_METADATA_LEN}})`, 'g');
const MINT_COMPLETION_WAIT_INTERVAL = 60000;
const SINGLE_NFT = 1;
const SPAN_TYPE = 'SPAN';
const VALUE_SUFFIX = 'value';

function toastMintError(error) {
  var message = error;
  if (typeof error === Object && 'message' in error) {
      message = error.message;
  } else if (typeof error === Object || typeof error === 'object') {
    message = JSON.stringify(error);
  }
  longToast(`Minting error occurred: ${message}`);
}

export function enableRecursively(domElement) {
  if (domElement.disabled) {
    domElement.disabled = false;
  }
  Array.from(domElement.children).forEach(enableRecursively);
}

export function generatePolicyScriptAndKey(e, policyAckDom, blockfrostDom, privKeyId, datetimeId, slotId, buttonsDom, displayDom, headerClassName, containerClassName) {
  e && e.preventDefault();

  var privateKey = NftPolicy.NftPolicy.privateKeyToCbor(LCore.PrivateKey.generate_ed25519());

  var privKeyContainer = document.createElement('div');
  privKeyContainer.className = containerClassName;
  var privKeyHeader = document.createElement('h4');
  privKeyHeader.textContent = 'Private Key:';
  privKeyHeader.className = headerClassName;
  var privKeySpan = document.createElement('span');
  privKeySpan.id = privKeyId;
  privKeySpan.textContent = privateKey;
  privKeyContainer.append(privKeyHeader, privKeySpan);

  var datetimeContainer = document.createElement('div');
  datetimeContainer.className = containerClassName;
  var datetimeHeader = document.createElement('h4');
  datetimeHeader.textContent = '(Optional) NFT Expiration';
  datetimeHeader.className = headerClassName;
  var datetimeLocal = document.createElement('input');
  datetimeLocal.id = datetimeId;
  datetimeLocal.min = new Date().toISOString().split('.')[0];
  datetimeLocal.type = 'datetime-local';
  datetimeContainer.append(datetimeHeader, datetimeLocal);
  datetimeLocal.addEventListener('change', e => NftPolicy.NftPolicy.updateDatetimeSlotSpan(e, blockfrostDom, `#${datetimeId}`, `#${slotId}`));

  var slotContainer = document.createElement('div');
  slotContainer.className = containerClassName;
  var slotHeader = document.createElement('h4');
  slotHeader.className = headerClassName;
  slotHeader.textContent = 'Slot (Auto-Generated Below)'
  var slotSpan = document.createElement('span');
  slotSpan.id = slotId;
  slotContainer.append(slotHeader, slotSpan);

  document.querySelector(buttonsDom).style.display = 'none';
  document.querySelector(displayDom).replaceChildren(privKeyContainer, datetimeContainer, slotContainer);

  alert('REMEMBER: YOU MUST COPY DOWN THE PRIVATE KEY AND CARDANO SLOT YOU GENERATE!');
  window.onbeforeunload = (_ => "Have you written down your private key and slot number?");

  document.querySelector(policyAckDom).style.display = 'block';
}

export function handleDappJsMessages(event, blockfrostDom, datetimeDom, slotDom) {
  // We only accept messages from ourselves
  if (event.source != window || !event.data.type) {
    return;
  }
  switch (event.data.type) {
    case "CARDANO_DAPP_JS_CONNECT":
      NftPolicy.NftPolicy.updateDatetimeSlotSpan(undefined, blockfrostDom, datetimeDom, slotDom);
      break;
    default:
      // Unknown message, return
      break;
  }
}

export function showInputForExistingKey(e, formDom, policyKeyId, policySlotId, useAllScriptsId, buttonsDom, displayDom, inputClassNames, checkboxClassNames) {
  e && e.preventDefault();

  document.querySelector(buttonsDom).style.display = 'none';
  document.querySelector(displayDom).replaceChildren(
    createTextInput(policyKeyId, inputClassNames, 'Paste NFT key here...'),
    createTextInput(policySlotId, inputClassNames, '(Optional) Enter NFT Slot Expiration Here...'),
    createCheckboxInput(useAllScriptsId, checkboxClassNames, 'Check this box if you are importing this project from NMKR Studio')
  );

  enableRecursively(document.querySelector(formDom));
}

export function handlePolicyAcknowledgement(e, policyAckDom, formDom){
  e && e.preventDefault();
  enableRecursively(document.querySelector(formDom));
  document.querySelector(policyAckDom).style.display = 'none';
}


export async function uploadToIpfs(e, nftStorageDom, fileDom, ipfsDisplayDom) {
  e && e.preventDefault();

  var ipfsDisplay = document.querySelector(ipfsDisplayDom);
  var existingIpfsDisplay = ipfsDisplay.innerHTML;
  ipfsDisplay.innerHTML = 'Upload in progress... please wait for browser alert';

  var nftStorageToken = document.querySelector(nftStorageDom).value;
  if (!nftStorageToken) {
    shortToast('Please enter an NFT.storage account key in the text box');
    ipfsDisplay.innerHTML = existingIpfsDisplay;
    return;
  }

  var fileInput = document.querySelector(fileDom);
  if (fileInput.files.length != 1) {
    shortToast(`Upload exactly 1 file, you uploaded ${fileInput.files.length}`);
    ipfsDisplay.innerHTML = existingIpfsDisplay;
    return;
  }

  try {
    const file = fileInput.files[0];
    const mimeType = mime.getType(file.name);
    const cid = await NftStorage.uploadFromFileInput(nftStorageToken, file);

    if ((mimeType === undefined) || !mimeType.startsWith(IMAGE_MIME_PREFIX)) {
      alert(`File '${file.name}' is of type '${mimeType}', not an image.  It will not show a thumbnail on web viewers like pool.pm.  To add a thumbnail to your NFT, please enter a trait at the right with Name 'image' and a link to your thumbnail in 'Value' (e.g., 'ipfs://Qmz...')`);
    }

    const ipfsIoAnchor = `<a id=${IPFS_LINK_ID} target="_blank" rel="noopener noreferrer" href="https://ipfs.io/ipfs/${cid}">ipfs://${cid}</a>`;
    const fileNameSpan = `<span id=${FILENAME_ID}>${file.name}</span>`;
    const mediaTypeSpan = `<span id=${FILETYPE_ID}>${mimeType}</span>`;
    ipfsDisplay.innerHTML = `${ipfsIoAnchor}<br/>(${fileNameSpan}&nbsp;[${mediaTypeSpan}])`;
    shortToast('Successfully uploaded your file using NFT.Storage!');
  } catch (err) {
    shortToast(`An error occurred uploading to NFT.storage: ${err}`);
  }
}

export async function performMintTxn(e, blockfrostDom, nameDom, datetimeDom, slotDom, useAllScriptsDom, scriptSKeyDom, ipfsDisplayDom, fileDom, traitsPrefix, numMintsDom) {
  e && e.preventDefault();

  try {
    var blockfrostKey = validated(document.querySelector(blockfrostDom).value, 'Please enter a valid Blockfrost API key in the text box');
    var cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before minting using "Connect Wallet" button');

    const policyExpirationSlot = await NftPolicy.NftPolicy.updateDatetimeSlotSpan(undefined, blockfrostDom, datetimeDom, slotDom);
    const wallet = await cardanoDApp.getConnectedWallet();
    const lucid = await LucidInst.getLucidInstance(blockfrostKey);
    validate(lucid, 'Your blockfrost key does not match the network of your wallet.');

    const useAllScripts = document.querySelector(useAllScriptsDom)?.checked;

    const nftName = validated(document.querySelector(nameDom)?.value, 'Please enter a name for NFT in the text box!');
    const nftMetadata = generateCip0025MetadataFor(nftName, ipfsDisplayDom, traitsPrefix)
    const scriptSKeyText = validated(NftPolicy.NftPolicy.getKeyFromInputOrSpan(scriptSKeyDom), 'Must either generate or enter a valid secret key before proceeding');
    const scriptSKey = NftPolicy.NftPolicy.privateKeyFromCbor(scriptSKeyText);
    const policyKeyHash = toHex(scriptSKey.to_public().hash().to_bytes());
    const nftPolicy = new NftPolicy.NftPolicy(policyExpirationSlot, scriptSKey, policyKeyHash, useAllScripts);
    const mintingPolicy = nftPolicy.getMintingPolicy();
    const numMints = validated(parseInt(document.querySelector(numMintsDom).value), 'Please enter the number of NFTs you would like to mint');
    if (numMints < 1 || numMints > Secrets.MAX_QUANTITY) {
      throw `Attempting to mint invalid number of NFTs (${numMints})`;
    }

    const fileEl = document.querySelector(fileDom);
    const fileNameEl = document.querySelector(`#${FILENAME_ID}`);
    if (fileEl.files.length > 0 && fileEl.files[0].name != fileNameEl?.textContent) {
      if (!confirm('The file you selected has not been uploaded yet, proceed?')) {
        return;
      }
    }

    const chainMetadata = wrapMetadataFor(mintingPolicy.policyID, nftMetadata);
    const assetName = `${mintingPolicy.policyID}${toHex(getTextEncoder().encode(nftName))}`
    const mintAssets = { [assetName]: numMints }

    const rebate = RebateCalculator.calculateRebate(RebateCalculator.SINGLE_POLICY, numMints, assetName.length);
    const mintVend = { [LOVELACE]: rebate, [assetName]: numMints };
    const update = (numMints == SINGLE_NFT) && (await existsOnChain(assetName, blockfrostKey));
    if (update && !confirm('The NFT you are trying to create already exists, would you like to perform an update (requires two transactions and signatures)?')) {
      return;
    }

    const domToClear = getDomElementsToClear(traitsPrefix, nameDom, fileDom, ipfsDisplayDom, numMintsDom);

    lucid.selectWallet(wallet);
    const address = await lucid.wallet.address();
    const availableUtxos = await lucid.wallet.getUtxos();
    const requiredAssets = {};
    if (lucid.network === 'Mainnet') {
      for (const availableUtxo of availableUtxos) {
        const assets = availableUtxo.assets;
        for (const asset in assets) {
          if (asset.startsWith(Secrets.REQUIRED_POLICY_KEY)) {
            requiredAssets[asset] = assets[asset];
          }
        }
      }
      const requiredAssetsFound = Object.values(requiredAssets).reduce((acc, amount) => acc + amount, 0n);
      if (requiredAssetsFound < Secrets.REQUIRED_POLICY_MIN) {
        alert(`Thanks for checking out this software! Testnet use is free, but to mint on mainnet, you must purchase at least ${Secrets.REQUIRED_POLICY_MIN} NFTs with policy ID ${Secrets.REQUIRED_POLICY_KEY} - no need to refresh the page!`);
        return;
      }
    }

    var txBuilder = lucid.newTx()
                         .attachMintingPolicy(mintingPolicy)
                         .attachMetadata(NftPolicy.METADATA_KEY, chainMetadata)
                         .mintAssets(mintAssets)
                         .payToAddress(address, mintVend);
    if (policyExpirationSlot) {
      txBuilder = txBuilder.validTo(lucid.utils.slotToUnixTime(policyExpirationSlot));
    }
    const txComplete = await txBuilder.complete();
    const txSigned = await txComplete.signWithPrivateKey(scriptSKey.to_bech32()).sign().complete();
    const txSubmit = await txSigned.submit();
    longToast(`Successfully sent minting tx: ${txSubmit}!`);
    domToClear.forEach(clearDomElement);

    if (update) {
      longToast('Will ask you to burn the NFT when mint is complete, please wait...');
      setTimeout(
        (async () => attemptBurn(assetName, mintingPolicy, scriptSKey, policyExpirationSlot, address, lucid, 1)).bind(this),
        MINT_COMPLETION_WAIT_INTERVAL
      );
    }
  } catch (err) {
    toastMintError(err);
  }
}

function getTextEncoder() {
  return new TextEncoder('UTF-8');
}

function wrapMetadataFor(policyID, innerMetadata) {
  return { [policyID]: innerMetadata, version: NftPolicy.CIP0025_VERSION };
}

function generateCip0025MetadataFor(nftName, ipfsDisplayDom, traitsPrefix) {
  var cip0025Metadata = {name: nftName};

  const ipfsDisplayEls = document.querySelector(ipfsDisplayDom);
  const ipfsCidLink = ipfsDisplayEls.querySelector(`#${IPFS_LINK_ID}`);
  if (ipfsCidLink) {
    const ipfsLink = validated(ipfsCidLink.textContent, 'There was an error retrieving IPFS link, did you upload the file correctly?').match(METADATA_SPLITTER);

    const ipfsMediaTypeDom = ipfsDisplayEls.querySelector(`#${FILETYPE_ID}`);
    const mediaType = validated(ipfsMediaTypeDom.textContent, 'Could not retrieve mime-type, unknown file uploaded which will cause rendering issues');

    if (mediaType.startsWith(IMAGE_MIME_PREFIX)) {
      cip0025Metadata['image'] = ipfsLink;
      cip0025Metadata['mediaType'] = mediaType;
    }

    // TODO: Support multiple file uploads simultaneously in this array
    cip0025Metadata['files'] = [{
      name: nftName,
      mediaType: mediaType,
      src: ipfsLink
    }];
  }


  document.querySelectorAll(`[id^=${traitsPrefix}-${KEY_SUFFIX}]`).forEach(trait => {
    const traitKey = trait.value;
    const traitValue = document.getElementById(trait.id.replace(KEY_SUFFIX, VALUE_SUFFIX)).value;
    if (traitKey) {
      if (traitValue.length > NftPolicy.NftPolicy.MAX_METADATA_LEN) {
        if (traitKey !== IMAGE_FIELD) {
          validate(
            confirm(`Metadata value for '${traitKey}' is greater than Cardano will allow (max of ${NftPolicy.NftPolicy.MAX_METADATA_LEN} chars), would you like to split it into an array automatically?`),
            'Aborting due to lengthy metadata'
          );
        }
        cip0025Metadata[traitKey] = traitValue.match(METADATA_SPLITTER);
      } else {
        cip0025Metadata[traitKey] = traitValue;
      }
    } else if (traitValue) {
      throw `Missing name for trait '${traitValue}'`;
    }
  });
  return {[nftName]: cip0025Metadata};
}

function getDomElementsToClear(traitsPrefix, ...otherDomElements) {
  var domElements = [];
  document.querySelectorAll(`[id^=${traitsPrefix}-${VALUE_SUFFIX}]`).forEach(trait =>
    domElements.push(`#${trait.id}`)
  );
  for (const domElement of otherDomElements) {
    domElements.push(domElement);
  }
  return domElements;
}

async function existsOnChain(assetName, blockfrostKey) {
  const blockfrostSettings = await LucidInst.getBlockfrostParams(blockfrostKey);
  let result = await fetch(`${blockfrostSettings.api}/assets/${assetName}`,
    { headers: { project_id: blockfrostKey } }
  ).then(res => res.json());
  if (result && result.error) {
    return false;
  }
  return true;
}

async function attemptBurn(assetName, mintingPolicy, scriptSKey, policyExpirationSlot, address, lucid, attempt) {
  try {
    const mintAssets = { [assetName]: -1 };
    var txBuilder = await lucid.newTx()
                                .attachMintingPolicy(mintingPolicy)
                                .mintAssets(mintAssets);
    if (policyExpirationSlot) {
      txBuilder = txBuilder.validTo(lucid.utils.slotToUnixTime(policyExpirationSlot));
    }
    const txComplete = await txBuilder.complete();
    const txSigned = await txComplete.signWithPrivateKey(scriptSKey.to_bech32()).sign().complete();
    const txSubmit = await txSigned.submit();
    longToast(`Successfully sent burning tx: ${txSubmit}!`);
  } catch (err) {
    if (attempt < MAX_BURN_ATTEMPTS) {
      longToast(`Error occurred burning, will retry shortly (${err})`);
      setTimeout(
        (async () => attemptBurn(assetName, rebate, mintingPolicy, scriptSKey, policyExpirationSlot, address, lucid, attempt + 1)).bind(this),
        MINT_COMPLETION_WAIT_INTERVAL
      );
    } else {
      longToast(`Unrecoverable error, contact developer: ${err}`);
    }
  }
}

function clearDomElement(domQuery) {
  var domEl = document.querySelector(domQuery);
  if (domEl.nodeName === SPAN_TYPE) {
    domEl.textContent = '';
  } else if (domEl.nodeName === INPUT_TYPE) {
    domEl.value = '';
  }
  domEl.dispatchEvent(new Event('change'));
}
