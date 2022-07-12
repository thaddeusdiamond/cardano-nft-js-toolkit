import arrayShuffle from 'array-shuffle';
import {toHex} from "lucid-cardano";

import * as Secrets from "../secrets.js";

import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";
import * as NftPolicy from "../nft-toolkit/nft-policy.js";

import {shortToast, longToast} from "../third-party/toastify-utils.js";
import {validate, validated} from "../nft-toolkit/utils.js";

const POLICY_ID_REGEX = /^[0-9a-f]{56}$/;
const IPFS_START = 'ipfs://'
const INVALID_IPFS_START = `${IPFS_START}bafy`;

var VendingMachineInst = undefined;
var MetadataRef = undefined;

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
  } else if (lucid.network === 'Testnet') {
    // Manual here just to ensure there's no funny business switching around networks in the debugger
    if (!(blockfrostKey.startsWith('testnet') && (lucid.network === 'Testnet'))) {
      throw 'Odd state detected... contact developer for more information.'
    }
  } else {
    throw `Unknown network detected ${lucid.network}`;
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
      validate(!metadata['721'], `Do not use the "721" identifier in your metadata, use the asset name directly ("${metadataFiles[i].name}")`);
      var keys = Object.keys(metadata);
      validate(keys.length == 1, `Please put exactly 1 asset in each file (${metadataFiles[i].name})`);
      validate(!keys[0].match(POLICY_ID_REGEX), `Suspected policy ID "${keys[0]}" found, use the asset name directly ("${metadataFiles[i].name}")`);
      validateAssetMetadata(keys[0], metadata[keys[0]], metadataFilename);
      MetadataRef.push(metadata);

      if (progressFunc) {
        progressFunc(i + 1, metadataFiles.length, metadataFiles[i].name);
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
  nftPolicyKeyDom, vendingMachineAddrDom, vendingMachineSkeyDom,
  profitVaultAddrDom, mintPriceDom, singleVendMaxDom, vendRandomlyDom, metadataFilesDom
) {
  e && e.preventDefault();

  try {
    var blockfrostKey = validated(document.querySelector(blockfrostApiKeyDom)?.value, 'Please enter a valid Blockfrost API key in the text box');
    validate(Selector.isWalletConnected(), 'Please connect a wallet before vending using "Connect Wallet" button');
    validate(MetadataRef, 'Please upload metadata files before turning the vending machine on');
    await validatePermissionsForRequiredAssets(blockfrostKey, MetadataRef.length);

    var policyExpirationSlot = await NftPolicy.NftPolicy.updateDatetimeSlotSpan(undefined, blockfrostApiKeyDom, expirationDatetimeDom, nftPolicySlotDom);
    var policySKeyText = validated(NftPolicy.NftPolicy.getKeyFromInputOrSpan(nftPolicyKeyDom), 'Must either generate or enter a valid secret key before proceeding');
    var policySKey = NftPolicy.NftPolicy.privateKeyFromCbor(policySKeyText);
    var policyKeyHash = toHex(policySKey.to_public().hash().to_bytes());

    var nftPolicy = new NftPolicy.NftPolicy(policyExpirationSlot, policySKey, policyKeyHash);
    var vendingMachine = new VendingMachine(MetadataRef, nftPolicy, blockfrostKey, vendingMachineAddrDom, vendingMachineSkeyDom, profitVaultAddrDom, mintPriceDom, singleVendMaxDom, vendRandomlyDom, metadataFilesDom, outputDom);

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
  static LOVELACE = 'lovelace';
  static KEYS_TO_STRINGIFY = ['', 'blockfrostKey', 'mintPrice', 'nftPolicy', 'slot', 'pubKeyHash', 'profitVaultAddr', 'singleVendMax', 'vendRandomly', 'vendingMachineAddr'];
  static NO_LIMIT = 100;
  static VENDING_INTERVAL = 5000;

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

    if (!this.mintPrice) {
      validate(this.singleVendMax, 'Must explicitly specify single vend max for free mints');
    } else if (!this.singleVendMax) {
      this.singleVendMax = VendingMachine.NO_LIMIT;
    }

    validate(this.vendingMachineAddr != this.profitVaultAddr, 'Cannot have the same address for profit vault and vending machine');

    var pendingFiles = this.metadataFilesEl.files.length;
    validate(!pendingFiles || confirm('You have metadata files that have not been uploaded, proceed?'), 'User aborted to upload files');

    validate(this.metadata !== undefined, "Metadata may be empty but it must not be undefined");
    if (this.vendRandomly) {
      this.metadata = arrayShuffle(this.metadata);
    }

    var lucid = await LucidInst.getLucidInstance(this.blockfrostKey);
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

    this.log(`${this.metadata.length} mints remaining.  Looking for new UTXOs in vending machine...`);
    var utxos = await this.lucid.utxosAtWithUnit(this.vendingMachineAddr, VendingMachine.LOVELACE);
    for (var utxo of utxos) {
      var utxoWithIx = `${utxo.txHash}#${utxo.outputIndex}`;
      if (this.exclusions.includes(utxoWithIx)) {
        continue;
      }
      this.exclusions.push(utxoWithIx);

      var balance = utxo.assets[VendingMachine.LOVELACE];
      var numMintsRequested = this.mintPrice ? Number(balance / this.mintPrice) : this.singleVendMax;
      var numMints = Math.min(this.singleVendMax, this.metadata.length, numMintsRequested);
      this.log(`Attempting to mint ${numMints} (${numMintsRequested} requested)`)

      var mintingPolicy = this.nftPolicy.getMintingPolicy();
      var mergedMetadata = {};
      var mintAssets = {};
      var totalNameChars = 0;
      for (var i = 0; i < numMints; i++) {
        // TODO: How to alert about failed vends???
        var nftMetadata = this.metadata.pop();
        this.log(JSON.stringify(nftMetadata))
        validate(Object.keys(nftMetadata).length == 1, `Only 1 asset name permitted per file, found ${Object.keys(nftMetadata)}`);

        var nftName = Object.keys(nftMetadata)[0];
        var assetName = `${mintingPolicy.policyID}${toHex(nftName)}`;
        mintAssets[assetName] = 1;
        mergedMetadata[nftName] = nftMetadata;
        totalNameChars += nftName.length;
      }

      var inputs = await this.lucid.inputsOf(utxo);
      var inputAddress = validated(inputs[0], `Could not find input for ${utxo.txHash}#${utxo.outputIndex}`);
      if (!numMints || !this.mintPrice) {
        var overage = 0n;
        var changeAddress = inputAddress;
      } else {
        var overage = balance - (BigInt(numMints) * this.mintPrice);
        var changeAddress = this.profitVaultAddr;
      }

      var txBuilder = this.lucid.newTx().collectFrom([utxo]);
      if (overage) {
        txBuilder = txBuilder.payToAddress(inputAddress, {lovelace: overage});
      }
      if (numMints) {
        txBuilder = txBuilder.attachMintingPolicy(mintingPolicy)
                             .attachMetadata(NftPolicy.METADATA_KEY, {[mintingPolicy.policyID] : mergedMetadata})
                             .mintAssets(mintAssets)
                             .payToAddress(inputAddress, mintAssets);
      }
      if (this.nftPolicy.slot) {
        txBuilder = txBuilder.validTo(this.lucid.utils.slotToUnixTime(this.nftPolicy.slot));
      }
      txBuilder.complete({changeAddress: changeAddress}).then(tx => {
        if (tx.txComplete.body().mint()) {
          tx = tx.signWithPrivateKey(this.nftPolicy.key.to_bech32());
        }
        tx.signWithPrivateKey(this.vendingMachineSkey.to_bech32())
          .complete()
          .then((signedTx => {
            this.log(signedTx.txSigned.body().to_json());
            signedTx.submit().then((txHash => {
              this.log(`Signed transaction submitted as ${txHash}`);
              shortToast(`Successfully processed a new customer order!`);
            }).bind(this));
          }).bind(this));
      });
    }

    setTimeout((_ => this.vend()).bind(this), VendingMachine.VENDING_INTERVAL);
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
