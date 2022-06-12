import * as Secrets from "../secrets.js";
import * as Selector from "./wallet-selector.js";
import * as LucidInst from "./lucid-inst.js";
import * as NftStorage from "./nft-storage.js";

import {toHex, fromHex, C as LCore} from "lucid-cardano";

const CBOR_PREFIX = '5820';
const CIP0025_VERSION = '1.0';
const FILENAME_ID = 'local-file-name';
const FILETYPE_ID = 'local-file-mimetype';
const INPUT_TYPE = 'INPUT';
const IPFS_LINK_ID = 'ipfs-io-link';
const KEY_SUFFIX = 'name';
const METADATA_KEY = '721';
const SPAN_TYPE = 'SPAN';
const VALUE_SUFFIX = 'value';

function shortToast(message) {
  Toastify({text: message, duration: 3000}).showToast();
}

function longToast(message) {
  Toastify({text: message, duration: 6000}).showToast();
}

function toastMintError(error) {
  var message = error;
  if (typeof error === Object && 'message' in error) {
      message = error.message;
  } else if (typeof error === Object || typeof error === 'object') {
    message = JSON.stringify(error);
  }
  longToast(`Minting error occurred: ${message}`);
}

function privateKeyToCbor(privateKey) {
  return `${CBOR_PREFIX}${toHex(privateKey.as_bytes())}`;
}

function privateKeyFromCbor(privateKeyCbor) {
  var privateKeyHex = fromHex(privateKeyCbor.substring(CBOR_PREFIX.length));
  return LCore.PrivateKey.from_normal_bytes(privateKeyHex);
}

export function enableRecursively(domElement) {
  if (domElement.disabled) {
    domElement.disabled = false;
  }
  Array.from(domElement.children).forEach(enableRecursively);
}

export function generatePolicyScriptAndKey(e, policyAckDom, blockfrostDom, privKeyId, datetimeId, slotId, buttonsDom, displayDom, headerClassName, containerClassName) {
  e && e.preventDefault();

  var privateKey = privateKeyToCbor(LCore.PrivateKey.generate_ed25519());

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
  datetimeLocal.addEventListener('change', e => updateDatetimeSlotSpan(e, blockfrostDom, `#${datetimeId}`, `#${slotId}`));

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

function updateDatetimeSlotSpan(e, blockfrostDom, datePickerDom, slotDisplayDom) {
  var blockfrostKey = document.querySelector(blockfrostDom).value;
  if (!blockfrostKey) {
    shortToast('Slot value needs Blockfrost key to be computed');
    return;
  }

  var lucidPromise = LucidInst.getLucidInstance(blockfrostKey, blockfrostKey);
  if (!lucidPromise) {
    shortToast('Please connect wallet to generate slot value');
    return;
  }

  return lucidPromise.then(lucid => {
    var slotInput = document.querySelector(slotDisplayDom)?.value;
    if (slotInput) {
      var slotNum = parseInt(slotInput);
      if (isNaN(slotNum)) {
        throw `Could not parse ${slotInput}`;
      }
      return slotNum;
    }

    var datetimeStr = document.querySelector(datePickerDom)?.value;
    if (datetimeStr) {
      var unixTimestamp = Date.parse(datetimeStr);
      var policyExpirationSlot = lucid.utils.unixTimeToSlot(unixTimestamp);
      document.querySelector(slotDisplayDom).textContent = policyExpirationSlot;
      return policyExpirationSlot;
    }

    return undefined;
  });
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
    var mediaTypeSpan = `<span id=${FILETYPE_ID}>${file.type}</span>`;
    ipfsDisplay.innerHTML = `${ipfsIoAnchor}<br/>(${fileNameSpan}&nbsp;[${mediaTypeSpan}])`;
    shortToast('Successfully uploaded your file using NFT.Storage!');
  });
}

export function performMintTxn(e, blockfrostDom, nameDom, datetimeDom, slotDom, scriptSKeyDom, ipfsDisplayDom, fileDom, traitsPrefix, numTraits) {
  e && e.preventDefault();

  var blockfrostKey = document.querySelector(blockfrostDom).value;
  if (!blockfrostKey) {
    shortToast('Please enter a valid Blockfrost API key in the text box');
    return;
  }

  if (!Selector.isWalletConnected()) {
    shortToast('Please connect a wallet before minting using "Connect Wallet" button');
    return;
  }

  var updateDatetimePromise = updateDatetimeSlotSpan(undefined, blockfrostDom, datetimeDom, slotDom);
  if (!updateDatetimePromise) {
    // Message already displayed in the nested call
    return;
  }

  updateDatetimePromise.then(policyExpirationSlot => {
    Selector.enableWallet(Selector.getConnectedWallet()).then(wallet => {
      LucidInst.getLucidInstance(blockfrostKey, blockfrostKey).then(lucid => {
        if (lucid === undefined) {
          longToast('Your blockfrost key does not match the network of your wallet.');
          return;
        }

        if (lucid.network !== 'Testnet') {
          longToast('Mainnet not supported yet, please switch wallet network.');
          return;
        }

        var nftName = document.querySelector(nameDom).value;
        if (!nftName) {
          shortToast('Please enter a name for NFT in the text box!');
          return;
        }

        var scriptSKeyText = getFromInputOrSpan(scriptSKeyDom);
        if (!scriptSKeyText) {
          shortToast('Must either generate or enter a valid secret key before proceeding');
          return;
        }

        try {
          var scriptSKey = privateKeyFromCbor(scriptSKeyText);
        } catch (error) {
          shortToast(`Could not construct private key from '${scriptSKeyText}': ${error}`);
          return;
        }
        var scriptVKey = scriptSKey.to_public();
        var policyKeyHash = toHex(scriptVKey.hash().to_bytes());

        var fileEl = document.querySelector(fileDom);
        var fileNameEl = document.querySelector(`#${FILENAME_ID}`);
        if (fileEl.files.length > 0 && fileEl.files[0].name != fileNameEl?.textContent) {
          if (!confirm('The file you selected has not been uploaded yet, proceed?')) {
            return;
          }
        }

        var mintingPolicy = undefined;
        if (policyExpirationSlot) {
          mintingPolicy = getMintingPolicyFor(policyKeyHash, policyExpirationSlot);
        } else {
          mintingPolicy = getSigNativeScriptFor(policyKeyHash);
        }

        // TODO: Support multiple assets (nftName and metadata will break here!)
        var nftMetadata = generateCip0025MetadataFor(nftName, ipfsDisplayDom, traitsPrefix, numTraits)
        if (!nftMetadata) {
          return;
        }
        var chainMetadata = wrapMetadataFor(mintingPolicy.policyID, nftMetadata);
        var assetName = `${mintingPolicy.policyID}${toHex(nftName)}`
        var mintAssets = { [assetName]: 1 }

        var domToClear = getDomElementsToClear(traitsPrefix, numTraits, nameDom, fileDom, ipfsDisplayDom);

        lucid.selectWallet(wallet);
        lucid.wallet.address().then(address => {
          var txBuilder = lucid.newTx()
                               .attachMintingPolicy(mintingPolicy)
                               .attachMetadata(METADATA_KEY, chainMetadata)
                               .mintAssets(mintAssets)
                               .payToAddress(address, mintAssets);
          if (policyExpirationSlot) {
            txBuilder = txBuilder.validTo(lucid.utils.slotToUnixTime(policyExpirationSlot));
          }
          txBuilder.complete().then(tx => signAndSubmitTxn(tx, scriptSKey, domToClear)).catch(toastMintError);
        });
      }).catch(e => toastMintError('Could not initialize Lucid (check your blockfrost key)'));
    }).catch(e => toastMintError(`Could not initialize the wallet that you selected: ${e}`));
  }).catch(e => toastMintError(`Could not interpret slot: ${e}`));
}

function getFromInputOrSpan(inputOrSpanDom) {
  var inputOrSpanEl = document.querySelector(inputOrSpanDom);
  if (inputOrSpanEl.nodeName === SPAN_TYPE) {
    return inputOrSpanEl.textContent;
  } else if (inputOrSpanEl.nodeName === INPUT_TYPE) {
    return inputOrSpanEl.value;
  }
  longToast('Illegal state exception, contact developer!');
}

function getSigNativeScriptFor(policyKeyHash) {
  var scriptPubkey = LCore.Ed25519KeyHash.from_hex(policyKeyHash);
  var sigMatches = LCore.ScriptPubkey.new(scriptPubkey);
  var sigNativeScript = LCore.NativeScript.new_script_pubkey(sigMatches);

  return {
    type: "Native",
    policyID: toHex(sigNativeScript.hash().to_bytes()),
    script: toHex(sigNativeScript.to_bytes()),
    scriptObj: sigNativeScript
  }
}

function getMintingPolicyFor(policyKeyHash, slotExpiration) {
  var policyNativeScripts = LCore.NativeScripts.new();

  var beforeTimelockSlot = LCore.BigNum.from_str(slotExpiration.toString());
  var beforeTimelock = LCore.TimelockExpiry.new(beforeTimelockSlot);
  var beforeNativeScript = LCore.NativeScript.new_timelock_expiry(beforeTimelock);
  policyNativeScripts.add(beforeNativeScript);

  policyNativeScripts.add(getSigNativeScriptFor(policyKeyHash).scriptObj);

  var policyAllScripts = LCore.ScriptAll.new(policyNativeScripts);
  var policyScript = LCore.NativeScript.new_script_all(policyAllScripts);

  return {
    type: "Native",
    policyID: toHex(policyScript.hash().to_bytes()),
    script: toHex(policyScript.to_bytes()),
    scriptObj: policyScript
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
    cip0025Metadata['image'] = ipfsCidLink.textContent;
  }
  var ipfsMimeType = ipfsDisplayEls.querySelector(`#${FILETYPE_ID}`);
  if (ipfsMimeType) {
    cip0025Metadata['mediaType'] = ipfsMimeType.textContent;
  }

  for (var i = 1; i <= numTraits; i++) {
    var traitKey = document.querySelector(`${traitsPrefix}-${KEY_SUFFIX}-${i}`).value;
    var traitValue = document.querySelector(`${traitsPrefix}-${VALUE_SUFFIX}-${i}`).value;
    if (traitKey) {
      cip0025Metadata[traitKey] = traitValue;
    } else if (traitValue) {
      shortToast(`Missing name for trait '${traitValue}'`);
      return undefined;
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
      Toastify({
        text: `Successfully sent minting tx: ${txHash}!`,
        duration: 6000
      }).showToast();
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
