import {toHex, fromHex, C as LCore} from "lucid-cardano";
import mime from "mime";

import * as Secrets from "../secrets.js";

import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";
import * as NftPolicy from "../nft-toolkit/nft-policy.js";
import * as NftStorage from "../third-party/nft-storage.js";

import {shortToast, longToast} from "../third-party/toastify-utils.js";
import {validate, validated} from "../nft-toolkit/utils.js";
import {RebateCalculator} from "../nft-toolkit/rebate-calculator.js";

const CIP0025_VERSION = '1.0';
const FILENAME_ID = 'local-file-name';
const FILETYPE_ID = 'local-file-mimetype';
const IMAGE_MIME_PREFIX = 'image/'
const INPUT_TYPE = 'INPUT';
const IPFS_LINK_ID = 'ipfs-io-link';
const KEY_SUFFIX = 'name';
const LOVELACE = 'lovelace';
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
  datetimeLocal.type = 'datetime-local';
  datetimeContainer.append(datetimeHeader, datetimeLocal);
  datetimeLocal.addEventListener('change', e => NftPolicy.NftPolicy.updateDatetimeSlotSpan(e, blockfrostDom, `#${datetimeId}`, `#${slotId}`));

  var slotContainer = document.createElement('div');
  slotContainer.className = containerClassName;
  var slotHeader = document.createElement('h4');
  slotHeader.className = headerClassName;
  slotHeader.textContent = 'Slot'
  var slotSpan = document.createElement('span');
  slotSpan.id = slotId;
  slotContainer.append(slotHeader, slotSpan);

  document.querySelector(buttonsDom).style.display = 'none';
  document.querySelector(displayDom).replaceChildren(privKeyContainer, datetimeContainer, slotContainer);

  alert('REMEMBER: YOU MUST COPY DOWN THE PRIVATE KEY AND CARDANO SLOT YOU GENERATE!');
  window.onbeforeunload = (_ => "Have you written down your private key and slot number?");

  document.querySelector(policyAckDom).style.display = 'block';
}

export function showInputForExistingKey(e, formDom, policyKeyId, policySlotId, buttonsDom, displayDom, classNames) {
  e && e.preventDefault();

  document.querySelector(buttonsDom).style.display = 'none';
  document.querySelector(displayDom).replaceChildren(
    createTextInput(policyKeyId, classNames, 'Paste NFT key here...'),
    createTextInput(policySlotId, classNames, '(Optional) Enter NFT Slot Expiration Here...')
  );

  enableRecursively(document.querySelector(formDom));
}

function createTextInput(id, cssClass, placeholder) {
  var input = document.createElement('input');
  input.type = 'text';
  input.id = id;
  input.className = cssClass;
  input.placeholder = placeholder;
  return input;
}

export function handlePolicyAcknowledgement(e, policyAckDom, formDom){
  e && e.preventDefault();
  enableRecursively(document.querySelector(formDom));
  document.querySelector(policyAckDom).style.display = 'none';
}


export function uploadToIpfs(e, nftStorageDom, fileDom, ipfsDisplayDom) {
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
    Toastify({
      text: `Upload exactly 1 file, you uploaded ${fileInput.files.length}`,
      duration: 3000
    }).showToast();
    ipfsDisplay.innerHTML = existingIpfsDisplay;
    return;
  }

  var file = fileInput.files[0];
  NftStorage.uploadFromFileInput(nftStorageToken, file).then(cid => {
    var ipfsIoAnchor = `<a id=${IPFS_LINK_ID} target="_blank" rel="noopener noreferrer" href="https://ipfs.io/ipfs/${cid}">${cid}</a>`;
    var fileNameSpan = `<span id=${FILENAME_ID}>${file.name}</span>`;
    var mediaTypeSpan = `<span id=${FILETYPE_ID}>${mime.getType(file.name)}</span>`;
    ipfsDisplay.innerHTML = `${ipfsIoAnchor}<br/>(${fileNameSpan}&nbsp;[${mediaTypeSpan}])`;
    shortToast('Successfully uploaded your file using NFT.Storage!');
  }).catch(err => shortToast(`An error occurred uploading to NFT.storage: ${err}`));
}

export function performMintTxn(e, blockfrostDom, nameDom, datetimeDom, slotDom, scriptSKeyDom, ipfsDisplayDom, fileDom, traitsPrefix, numTraits, numMintsDom) {
  e && e.preventDefault();

  try {
    var blockfrostKey = validated(document.querySelector(blockfrostDom).value, 'Please enter a valid Blockfrost API key in the text box');
    var cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before minting using "Connect Wallet" button');

    NftPolicy.NftPolicy.updateDatetimeSlotSpan(undefined, blockfrostDom, datetimeDom, slotDom).then(policyExpirationSlot => {
      cardanoDApp.getConnectedWallet().then(wallet => {
        LucidInst.getLucidInstance(blockfrostKey).then(lucid => {
          try {
            validate(lucid, 'Your blockfrost key does not match the network of your wallet.');

            var nftName = validated(document.querySelector(nameDom)?.value, 'Please enter a name for NFT in the text box!');
            var nftMetadata = generateCip0025MetadataFor(nftName, ipfsDisplayDom, traitsPrefix, numTraits)
            var scriptSKeyText = validated(NftPolicy.NftPolicy.getKeyFromInputOrSpan(scriptSKeyDom), 'Must either generate or enter a valid secret key before proceeding');
            var scriptSKey = NftPolicy.NftPolicy.privateKeyFromCbor(scriptSKeyText);
            var policyKeyHash = toHex(scriptSKey.to_public().hash().to_bytes());
            var nftPolicy = new NftPolicy.NftPolicy(policyExpirationSlot, scriptSKey, policyKeyHash);
            var mintingPolicy = nftPolicy.getMintingPolicy();
            var numMints = validated(parseInt(document.querySelector(numMintsDom).value), 'Please enter the number of NFTs you would like to mint');
            if (numMints < 1 || numMints > Secrets.MAX_QUANTITY) {
              throw `Attempting to mint invalid number of NFTs (${numMints})`;
            }
          } catch (error) {
            shortToast(error);
            return;
          }

          var fileEl = document.querySelector(fileDom);
          var fileNameEl = document.querySelector(`#${FILENAME_ID}`);
          if (fileEl.files.length > 0 && fileEl.files[0].name != fileNameEl?.textContent) {
            if (!confirm('The file you selected has not been uploaded yet, proceed?')) {
              return;
            }
          }

          var chainMetadata = wrapMetadataFor(mintingPolicy.policyID, nftMetadata);
          var assetName = `${mintingPolicy.policyID}${toHex(nftName)}`
          var mintAssets = { [assetName]: numMints }

          var rebate = RebateCalculator.calculateRebate(RebateCalculator.SINGLE_POLICY, numMints, assetName.length);
          var mintVend = { [LOVELACE]: rebate, [assetName]: numMints }

          var domToClear = getDomElementsToClear(traitsPrefix, numTraits, nameDom, fileDom, ipfsDisplayDom, numMintsDom);

          lucid.selectWallet(wallet);
          lucid.wallet.address().then(address => {
            lucid.wallet.getUtxos().then(requiredPolicyUtxos => {
              var requiredAssets = {};
              if (lucid.network === 'Mainnet') {
                for (var requiredPolicyUtxo of requiredPolicyUtxos) {
                  var assets = requiredPolicyUtxo.assets;
                  for (assetName in assets) {
                    if (assetName.startsWith(Secrets.REQUIRED_POLICY_KEY)) {
                      requiredAssets[assetName] = assets[assetName];
                    }
                  }
                }
                var requiredAssetsFound = Object.values(requiredAssets).reduce((acc, amount) => acc + amount, 0n);
                if (requiredAssetsFound < Secrets.REQUIRED_POLICY_MIN) {
                  alert(`Thanks for checking out this software! Testnet use is free, but to mint on mainnet, you must purchase at least ${Secrets.REQUIRED_POLICY_MIN} NFTs with policy ID ${Secrets.REQUIRED_POLICY_KEY} - no need to refresh the page!`);
                  return;
                }
              } else if (lucid.network === 'Testnet') {
                // Manual here just to ensure there's no funny business switching around networks in the debugger
                if (!(document.querySelector(blockfrostDom).value.startsWith('testnet') && (lucid.network === 'Testnet'))) {
                  throw 'Odd state detected... contact developer for more information.'
                }
              } else {
                longToast(`Unknown network detected ${lucid.network}`);
                return;
              }

              var txBuilder = lucid.newTx()
                                   .attachMintingPolicy(mintingPolicy)
                                   .attachMetadata(NftPolicy.METADATA_KEY, chainMetadata)
                                   .mintAssets(mintAssets)
                                   .payToAddress(address, mintVend);
              if (policyExpirationSlot) {
                txBuilder = txBuilder.validTo(lucid.utils.slotToUnixTime(policyExpirationSlot));
              }
              txBuilder.complete().then(tx => signAndSubmitTxn(tx, scriptSKey, domToClear)).catch(toastMintError);
            }).catch(e => toastMintError(`Unknown error retrieving your wallet address: ${e}`));
          }).catch(e => toastMintError(`Unknown error validating wallet: ${e}`));
        }).catch(e => toastMintError('Could not initialize Lucid (check your blockfrost key)'));
      }).catch(e => toastMintError(`Could not initialize the wallet that you selected: ${e}`));
    }).catch(e => toastMintError(`Could not interpret slot: ${e}`));
  } catch (err) {
    shortToast(err);
  }
}

function wrapMetadataFor(policyID, innerMetadata) {
  return { [policyID]: innerMetadata, version: CIP0025_VERSION };
}

function generateCip0025MetadataFor(nftName, ipfsDisplayDom, traitsPrefix, numTraits) {
  var cip0025Metadata = {name: nftName};

  var ipfsDisplayEls = document.querySelector(ipfsDisplayDom);
  var ipfsCidLink = ipfsDisplayEls.querySelector(`#${IPFS_LINK_ID}`);
  if (ipfsCidLink) {
    var ipfsLink = validated(ipfsCidLink.textContent, 'There was an error retrieving IPFS link, did you upload the file correctly?');

    var ipfsMediaTypeDom = ipfsDisplayEls.querySelector(`#${FILETYPE_ID}`);
    var mediaType = validated(ipfsMediaTypeDom.textContent, 'Could not retrieve mime-type, unknown file uploaded which will cause rendering issues');

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

  for (var i = 1; i <= numTraits; i++) {
    var traitKey = document.querySelector(`${traitsPrefix}-${KEY_SUFFIX}-${i}`).value;
    var traitValue = document.querySelector(`${traitsPrefix}-${VALUE_SUFFIX}-${i}`).value;
    if (traitKey) {
      cip0025Metadata[traitKey] = traitValue;
    } else if (traitValue) {
      throw `Missing name for trait '${traitValue}'`;
    }
  }
  return {[nftName]: cip0025Metadata};
}

function getDomElementsToClear(traitsPrefix, numTraits, ...otherDomElements) {
  var domElements = [];
  for (var i = 1; i <= numTraits; i++) {
    domElements.push(`${traitsPrefix}-${VALUE_SUFFIX}-${i}`);
  }
  for (const domElement of otherDomElements) {
    domElements.push(domElement);
  }
  return domElements;
}

function signAndSubmitTxn(tx, scriptSKey, domToClear) {
  tx.signWithPrivateKey(scriptSKey.to_bech32()).sign().complete().then(signedTx =>
    signedTx.submit().then(txHash => {
      longToast(`Successfully sent minting tx: ${txHash}!`);
      domToClear.forEach(clearDomElement);
    })
  ).catch(toastMintError);
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
