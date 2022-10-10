import {toHex, networkToId, C as LCore} from "lucid-cardano";

import * as Secrets from "../secrets.js";

import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";
import * as NftPolicy from "../nft-toolkit/nft-policy.js";

import {shortToast, longToast} from "../third-party/toastify-utils.js";
import {validate, validated, createTextInput, createTextareaInput} from "../nft-toolkit/utils.js";

const POLICY_ID_REGEX = /^[0-9a-f]{56}$/;
const IPFS_START = 'ipfs://'
const INVALID_IPFS_START = `${IPFS_START}bafy`;

var VendingMachineInst = undefined;
var MetadataRef = undefined;
var HasAcknowledgedKeyGeneration = false;

export async function generateVmKeyAndAddr(e, vmAckDom, blockfrostDom, privKeyId, addrId, buttonsDom, displayDom, containerClassName) {
  e && e.preventDefault();
  try {
    var blockfrostKey = validated(document.querySelector(blockfrostDom).value, 'Vending Machine address needs Blockfrost key to be generated');
    var lucidPromise = validated(LucidInst.getLucidInstance(blockfrostKey), 'Please connect wallet to generate vending machine address');
    var lucid = validated(await lucidPromise, 'Mismatch between blockfrost key and wallet network');

    var privateKey = LCore.PrivateKey.generate_ed25519();
    var vmKeyCbor = NftPolicy.NftPolicy.privateKeyToCbor(privateKey);
    var vmAddr = LCore.EnterpriseAddress.new(
      networkToId(lucid.network),
      LCore.StakeCredential.from_keyhash(privateKey.to_public().hash())
    )

    var addrContainer = document.createElement('div');
    addrContainer.className = containerClassName;
    var addrSpan = document.createElement('span');
    addrSpan.textContent = vmAddr.to_address().to_bech32();
    var addrHidden = document.createElement('input');
    addrHidden.type = 'hidden';
    addrHidden.id = addrId;
    addrHidden.value = vmAddr.to_address().to_bech32();
    addrContainer.append(addrSpan, addrHidden);

    var privKeyContainer = document.createElement('div');
    privKeyContainer.className = containerClassName;
    var privKeySpan = document.createElement('span');
    privKeySpan.textContent = `(${vmKeyCbor})`;
    var privKeyHidden = document.createElement('input');
    privKeyHidden.type = 'hidden';
    privKeyHidden.id = privKeyId;
    privKeyHidden.value = vmKeyCbor;
    privKeyContainer.append(privKeySpan, privKeyHidden);

    document.querySelector(buttonsDom).style.display = 'none';
    document.querySelector(displayDom).replaceChildren(addrContainer, privKeyContainer);

    alert('REMEMBER: YOU MUST COPY DOWN THE PRIVATE KEY AND ADDRESS OF THE VENDING MACHINE YOU GENERATED!');
    window.onbeforeunload = (_ => "Have you written down your private key and address?");

    document.querySelector(vmAckDom).style.display = 'block';
  } catch (err) {
    shortToast(err);
    MetadataRef = undefined;
    throw err;
  }
}

export function showInputForExistingVm(e, vmKeyId, vmAddrId, buttonsDom, displayDom, classNames) {
  e && e.preventDefault();

  document.querySelector(buttonsDom).style.display = 'none';
  document.querySelector(displayDom).replaceChildren(
    createTextInput(vmAddrId, classNames, '(Required) Enter Vending Machine Address...'),
    createTextareaInput(vmKeyId, classNames, '(Required) Enter Vending Machine Secret Key (Begins with 5820)...')
  );

  HasAcknowledgedKeyGeneration = true;
}

export function handlePolicyAcknowledgement(e, vmAckDom){
  e && e.preventDefault();
  HasAcknowledgedKeyGeneration = true;
  document.querySelector(vmAckDom).style.display = 'none';
}


async function validatePermissionsForRequiredAssets(cardanoDApp, blockfrostKey, numMetadata) {
  var wallet = validated(await cardanoDApp.getConnectedWallet(), 'Please connect a wallet using "Connect Wallet"');
  var lucid = validated(await LucidInst.getLucidInstance(blockfrostKey), 'Please check that your wallet network matches the blockfrost key network');
  lucid.selectWallet(wallet);

  var address = await lucid.wallet.address();
  var requiredPolicyUtxos = await lucid.wallet.getUtxos();

  var requiredAssets = {};
  if (lucid.network === 'Mainnet') {
    for (var requiredPolicyUtxo of requiredPolicyUtxos) {
      var assets = requiredPolicyUtxo.assets;
      for (var assetName in assets) {
        if (assetName.startsWith(Secrets.REQUIRED_POLICY_KEY)) {
          requiredAssets[assetName] = assets[assetName];
        }
      }
    }
    var requiredAssetsFound = Number(Object.values(requiredAssets).reduce((acc, amount) => acc + amount, 0n));
    if ((numMetadata / requiredAssetsFound) > Secrets.REQUIRED_VENDING_MACHINE_RATIO) {
      alert(`Thanks for checking out this software! Testnet use is free, but to mint on mainnet, you must purchase at least 1 NFT with policy ID ${Secrets.REQUIRED_POLICY_KEY} for every ${Secrets.REQUIRED_VENDING_MACHINE_RATIO} metadata files you upload - no need to refresh the page!`);
      throw 'Vending machine aborting';
    }
  }
}

export async function uploadMetadataFiles(e, metadataFilesDom, metadataUploadButtonDom, blockfrostApiKeyDom, progressFunc) {
  e && e.preventDefault();

  var metadataFiles = document.querySelector(metadataFilesDom)?.files;
  if (!metadataFiles) {
    return;
  }

  try {
    validate(!VendingMachineInst || !VendingMachineInst.isRunning, 'Cannot upload new metadata files while your vending machine is running!');
    document.querySelector(metadataUploadButtonDom).disabled = true;

    var cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before uploading metadata using "Connect Wallet" button');
    var wallet = await cardanoDApp.getConnectedWallet();

    var blockfrostKey = validated(document.querySelector(blockfrostApiKeyDom).value, 'Please enter a blockfrost key before uploading metadata');
    await validatePermissionsForRequiredAssets(cardanoDApp, blockfrostKey, metadataFiles.length);

    MetadataRef = [];
    var knownKeys = [];
    if (progressFunc) {
      progressFunc(0, metadataFiles.length, '');
    }
    for (var i = 0; i < metadataFiles.length; i++) {
      const metadataFilename = metadataFiles[i].name;
      try {
        var readPromise = new Promise((resolve, reject) => {
          var reader = new FileReader();
          reader.onloadend = (event => resolve(event.target.result));
          reader.onerror = (event => reject(event));
          reader.readAsText(metadataFiles[i]);
        });
        var metadataText = await readPromise;
        var metadata = JSON.parse(metadataText);
      } catch (err) {
        throw `Error reading "${metadataFilename}": ${err}`;
      }
      validate(!metadata['721'], `Do not use the "721" identifier in your metadata, use the asset name directly ("${metadataFilename}")`);
      var keys = Object.keys(metadata);
      validate(keys.length == 1, `Please put exactly 1 asset in each file (${metadataFilename})`);
      validate(!keys[0].match(POLICY_ID_REGEX), `Suspected policy ID "${keys[0]}" found, use the asset name directly ("${metadataFilename}")`);
      validate(!knownKeys.includes(keys[0]), `Encountered duplicate key ${keys[0]} among the metadata files ("${metadataFilename}")`)
      knownKeys.push(keys[0]);
      validateAssetMetadata(keys[0], metadata[keys[0]], metadataFilename);
      MetadataRef.push(metadata);

      if (progressFunc) {
        progressFunc(i + 1, metadataFiles.length, metadataFilename);
      }
    }

    shortToast(`Successfully uploaded ${metadataFiles.length} metadata files!`);
    document.querySelector(metadataFilesDom).value = '';
  } catch (err) {
    shortToast(err);
    MetadataRef = undefined;
    throw err;
  } finally {
    document.querySelector(metadataUploadButtonDom).disabled = false;
  }
}

function validateAssetMetadata(key, metadataVal, metadataFilename) {
  if (typeof(metadataVal) === 'string') {
    validate(!metadataVal.startsWith(INVALID_IPFS_START), `Using invalid IPFS link starting with ${INVALID_IPFS_START} in '${metadataFilename}' (remove '${IPFS_START}' to make the metadata work)`);
    validate(metadataVal.length <= NftPolicy.NftPolicy.MAX_METADATA_LEN, `Metadata value for ${key} (file '${metadataFilename}') is greater than Cardano will allow (max of ${NftPolicy.NftPolicy.MAX_METADATA_LEN} chars)`);
    return;
  }
  for (const subKey of Object.keys(metadataVal)) {
    validateAssetMetadata(subKey, metadataVal[subKey], metadataFilename);
  }
}

export async function startVending(
  e, outputDom, blockfrostApiKeyDom, expirationDatetimeDom, nftPolicySlotDom,
  useAllScriptsDom, nftPolicyKeyDom, vendingMachineAddrDom, vendingMachineSkeyDom,
  profitVaultAddrDom, mintPriceDom, singleVendMaxDom, vendRandomlyDom, metadataFilesDom
) {
  e && e.preventDefault();

  try {
    const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    const blockfrostKey = validated(document.querySelector(blockfrostApiKeyDom)?.value, 'Please enter a valid Blockfrost API key in the text box');
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before vending using "Connect Wallet" button');
    validate(MetadataRef, 'Please upload metadata files before turning the vending machine on');
    validate(HasAcknowledgedKeyGeneration, 'Please acknowledge you have written down your generated vending machine keys and address before proceeding');
    await validatePermissionsForRequiredAssets(cardanoDApp, blockfrostKey, MetadataRef.length);

    const policyExpirationSlot = await NftPolicy.NftPolicy.updateDatetimeSlotSpan(undefined, blockfrostApiKeyDom, expirationDatetimeDom, nftPolicySlotDom);
    const policySKeyText = validated(NftPolicy.NftPolicy.getKeyFromInputOrSpan(nftPolicyKeyDom), 'Must either generate or enter a valid secret key before proceeding');
    const policySKey = NftPolicy.NftPolicy.privateKeyFromCbor(policySKeyText);
    const policyKeyHash = toHex(policySKey.to_public().hash().to_bytes());
    const useAllScripts = document.querySelector(useAllScriptsDom)?.checked;

    const nftPolicy = new NftPolicy.NftPolicy(policyExpirationSlot, policySKey, policyKeyHash, useAllScripts);
    const vendingMachine = new VendingMachine(MetadataRef, nftPolicy, blockfrostKey, vendingMachineAddrDom, vendingMachineSkeyDom, profitVaultAddrDom, mintPriceDom, singleVendMaxDom, vendRandomlyDom, metadataFilesDom, outputDom);

    await vendingMachine.initialize();
    VendingMachineInst = vendingMachine;
  } catch (err) {
    shortToast(err);
    throw err;
  }
}

export async function stopVending(e) {
  e && e.preventDefault();

  validate(VendingMachineInst, 'Attempting to shut down unstarted vending machine');
  if (!confirm("Are you sure you want to shut down your vending machine?")) {
    shortToast('Shut down cancelled by user');
    return false;
  }

  try {
    await VendingMachineInst.shutDown();
    return true;
  } catch (err) {
    longToast(`Could not shut down vending machine: '${err}'.  To force quit, exit your browser tab`);
  } finally {
    VendingMachineInst = undefined;
    shortToast("Vending machine ended!");
  }
}

class VendingMachine {

  static ADA_TO_LOVELACE = 1000000n;
  static BACKOFF_WAIT = 5000;
  static LOVELACE = 'lovelace';
  static KEYS_TO_STRINGIFY = ['', 'blockfrostKey', 'mintPrice', 'nftPolicy', 'slot', 'policyID', 'pubKeyHash', 'profitVaultAddr', 'singleVendMax', 'useAllScripts', 'vendRandomly', 'vendingMachineAddr'];
  static MAX_RETRIES = 5;
  static MIN_MINT_PRICE_LOVELACE = 5000000n;
  static MIN_MINT_PRICE_ADA = VendingMachine.MIN_MINT_PRICE_LOVELACE / VendingMachine.ADA_TO_LOVELACE
  static NO_LIMIT = 100;
  static VENDING_INTERVAL = 15000;

  static #bigIntStringify(obj) {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    );
  }

  static getTextEncoder() {
    return new TextEncoder('UTF-8');
  }

  constructor(metadata, nftPolicy, blockfrostKey, vendingMachineAddrDom, vendingMachineSkeyDom, profitVaultAddrDom, mintPriceDom, singleVendMaxDom, vendRandomlyDom, metadataFilesDom, outputDom) {
    this.metadata = metadata;
    this.nftPolicy = nftPolicy;
    this.blockfrostKey = blockfrostKey;
    this.vendingMachineAddr = document.querySelector(vendingMachineAddrDom)?.value;
    this.vendingMachineSkeyVal = document.querySelector(vendingMachineSkeyDom)?.value;
    this.profitVaultAddr = document.querySelector(profitVaultAddrDom)?.value;
    this.mintPriceStr = document.querySelector(mintPriceDom)?.value;
    this.singleVendMax = document.querySelector(singleVendMaxDom)?.value;
    this.vendRandomly = document.querySelector(vendRandomlyDom)?.checked;
    this.metadataFilesEl = document.querySelector(metadataFilesDom);
    this.outputEl = document.querySelector(outputDom);
  }

  log(message) {
    this.outputEl.textContent += `[${new Date().toISOString()}] ${message}\n`;
  }

  async initialize() {
    validate(this.vendingMachineAddr, 'Please enter a valid vending machine address');
    validate(this.vendingMachineSkeyVal, 'Please enter a valid private key for the vending machine');
    this.vendingMachineSkey = validated(NftPolicy.NftPolicy.privateKeyFromCbor(this.vendingMachineSkeyVal), `Could not generate key from: '${this.vendingMachineSkeyVal}'`);

    validate(this.outputEl, 'Issue configuring output message box');
    validate(this.profitVaultAddr, 'Please enter a valid profit vault address');

    validate(this.mintPriceStr, 'No default values allowed for mint price.  For free mints, explicitly type 0');
    this.mintPrice = VendingMachine.ADA_TO_LOVELACE * BigInt(this.mintPriceStr);
    if (this.mintPrice) {
      validate(this.mintPrice >= VendingMachine.MIN_MINT_PRICE_LOVELACE, `Mints less than ${VendingMachine.MIN_MINT_PRICE_ADA}ADA are not supported`)
    }

    if (!this.mintPrice) {
      validate(this.singleVendMax, 'Must explicitly specify single vend max for free mints');
    } else if (!this.singleVendMax) {
      this.singleVendMax = VendingMachine.NO_LIMIT;
    }

    validate(this.vendingMachineAddr != this.profitVaultAddr, 'Cannot have the same address for profit vault and vending machine');

    const pendingFiles = this.metadataFilesEl.files.length;
    validate(!pendingFiles || confirm('You have metadata files that have not been uploaded, proceed?'), 'User aborted to upload files');

    validate(this.metadata !== undefined, "Metadata may be empty but it must not be undefined");
    if (this.vendRandomly) {
      this.metadata.sort((a, b) => 0.5 - Math.random());
    }

    const lucid = await LucidInst.getLucidInstance(this.blockfrostKey);
    this.lucid = validated(lucid, 'Your blockfrost key does not match the network of your wallet.');
    this.lucid.selectWalletFromPrivateKey(this.vendingMachineSkey.to_bech32());

    this.exclusions = [];
    this.isValidated = true;
    this.isRunning = true;
    this.log(`Vending machine initialized! ${this.toString()}`);

    this.log(`Starting on a loop for every ${VendingMachine.VENDING_INTERVAL}ms`);
    setTimeout((_ => this.vend()).bind(this), VendingMachine.VENDING_INTERVAL);
  }

  async vend() {
    if (!this.isRunning) {
      return;
    }

    validate(this.isValidated, 'State error: validate your vending machine before vending');

    try {
      this.log(`${this.metadata.length} mints remaining.  Looking for new UTXOs in vending machine...`);
      const utxos = await this.lucid.utxosAt(this.vendingMachineAddr);
      this.log(`Found UTxOs: ${VendingMachine.#bigIntStringify(utxos)}`);
      for (const utxo of utxos) {
        const utxoWithIx = `${utxo.txHash}#${utxo.outputIndex}`;
        if (this.exclusions.includes(utxoWithIx)) {
          continue;
        }

        this.log(`Handling ${VendingMachine.#bigIntStringify(utxo)}`);
        this.exclusions.push(utxoWithIx);
        const balance = utxo.assets[VendingMachine.LOVELACE];
        const numMintsRequested = this.mintPrice ? Number(balance / this.mintPrice) : this.singleVendMax;
        const numMints = Math.min(this.singleVendMax, this.metadata.length, numMintsRequested);
        this.log(`Attempting to mint ${numMints} (${numMintsRequested} requested)`)

        const mintingPolicy = this.nftPolicy.getMintingPolicy();
        var mergedMetadata = {};
        var mintAssets = {};
        var totalNameChars = 0;
        for (var i = 0; i < numMints; i++) {
          var nftMetadata = this.metadata.pop();
          this.log(JSON.stringify(nftMetadata))
          validate(Object.keys(nftMetadata).length == 1, `Only 1 asset name permitted per file, found ${Object.keys(nftMetadata)}`);

          const nftName = Object.keys(nftMetadata)[0];
          const assetName = `${mintingPolicy.policyID}${toHex(VendingMachine.getTextEncoder().encode(nftName))}`;
          mintAssets[assetName] = 1;
          mergedMetadata[nftName] = nftMetadata[nftName];
          totalNameChars += nftName.length;
        }

        const inputs = await this.#getInputsFor(utxo);
        const inputAddress = validated(inputs[0], `Could not find input for ${utxo.txHash}#${utxo.outputIndex}`);
        const overage = (!numMints || !this.mintPrice) ? 0n : (balance - (BigInt(numMints) * this.mintPrice));
        const changeAddress = (!numMints || !this.mintPrice) ? inputAddress : this.profitVaultAddr;

        const txBuilder = this.lucid.newTx().collectFrom([utxo]);
        if (overage) {
          txBuilder.payToAddress(inputAddress, {lovelace: overage});
        }
        if (numMints > 0) {
          txBuilder.attachMintingPolicy(mintingPolicy)
                   .attachMetadata(NftPolicy.METADATA_KEY, {[mintingPolicy.policyID] : mergedMetadata})
                   .mintAssets(mintAssets)
                   .payToAddress(inputAddress, mintAssets);
        }
        if (this.nftPolicy.slot) {
          txBuilder.validTo(this.lucid.utils.slotToUnixTime(this.nftPolicy.slot));
        }

        const txComplete = await txBuilder.complete({changeAddress: changeAddress, coinSelection: false});
        if (txComplete.txComplete.body().mint()) {
          txComplete.signWithPrivateKey(this.nftPolicy.key.to_bech32());
        }

        const txSigned = await txComplete.signWithPrivateKey(this.vendingMachineSkey.to_bech32()).complete();
        this.log(txSigned.txSigned.body().to_json());

        const txHash = await txSigned.submit();
        this.log(`Signed transaction submitted as ${txHash}`);

        shortToast(`Successfully processed a new customer order for ${numMints} NFTs!`);
      }
    } catch (err) {
      this.log(`AN ERROR OCCURRED -> DEBUG MANUALLY: ${err}`);
      shortToast(err);
    }

    setTimeout((_ => this.vend()).bind(this), VendingMachine.VENDING_INTERVAL);
  }

  async #getInputsFor(utxo) {
    for (var i = 0; i < VendingMachine.MAX_RETRIES; i++) {
      const result = await fetch(
        `${this.lucid.provider.data.url}/txs/${utxo.txHash}/utxos`,
        { headers: { project_id: this.blockfrostKey } }
      ).then(res => res.json());
      if (result && !result.error) {
        return result.inputs.map(input => input.address);
      }
      this.log(`${utxo.txHash} input retrieval failure: ${JSON.stringify(result)}`);
      await new Promise(resolve => setTimeout(resolve, VendingMachine.BACKOFF_WAIT));
    }
    throw `Failed to get inputs after ${VendingMachine.MAX_RETRIES}`;
  }

  shutDown() {
    this.isRunning = false;
    this.log('Vending machine shut down!');
  }

  toString() {
    return JSON.stringify(this, (key, value) => {
      if (!VendingMachine.KEYS_TO_STRINGIFY.includes(key)) {
        return undefined;
      }
      return (typeof value === 'bigint') ? value.toString() : value;
    });
  }
}
