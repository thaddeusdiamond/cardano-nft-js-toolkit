import {toHex, fromHex, C as LCore} from "lucid-cardano";

import * as LucidInst from "../third-party/lucid-inst.js";

import {validate, validated} from "../nft-toolkit/utils.js";

export const METADATA_KEY = '721';

const INPUT_TYPE = 'INPUT';
const SPAN_TYPE = 'SPAN';

export class NftPolicy {

  static MAX_METADATA_LEN = 64;

  static updateDatetimeSlotSpan(e, blockfrostDom, datePickerDom, slotDisplayDom) {
    var blockfrostKey = validated(document.querySelector(blockfrostDom).value, 'Slot value needs Blockfrost key to be computed');
    var lucidPromise = validated(LucidInst.getLucidInstance(blockfrostKey), 'Please connect wallet to generate slot value');

    return lucidPromise.then(lucid => {
      if (lucid === undefined) {
        throw 'Mismatch between blockfrost key and wallet network';
      }

      var slotInput = document.querySelector(slotDisplayDom)?.value;
      if (slotInput) {
        var slotNum = parseInt(slotInput);
        validate(!isNaN(slotNum), `Could not parse ${slotInput}`);
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

  static getKeyFromInputOrSpan(inputOrSpanDom) {
    var inputOrSpanEl = document.querySelector(inputOrSpanDom);
    if (inputOrSpanEl.nodeName === SPAN_TYPE) {
      return inputOrSpanEl.textContent;
    } else if (inputOrSpanEl.nodeName === INPUT_TYPE) {
      return inputOrSpanEl.value;
    }
    longToast('Illegal state exception, contact developer!');
  }

  static privateKeyToCbor(privateKey) {
    return toHex(privateKey.to_bytes());
  }

  static privateKeyFromCbor(privateKeyCbor) {
    try {
      return LCore.PrivateKey.from_bytes(fromHex(privateKeyCbor));
    } catch (err) {
      throw `Could not construct private key from '${privateKeyCbor}': ${err}`
    }
  }

  constructor(policyExpirationSlot, policySKey, policyPubKeyHash, useAllScripts) {
    this.slot = policyExpirationSlot;
    this.key = policySKey;
    this.pubKeyHash = policyPubKeyHash;
    this.useAllScripts = useAllScripts;
    this.mintingPolicy = this.#constructMintingPolicy();
    this.policyID = this.mintingPolicy.policyID;
  }

  #constructMintingPolicy() {
    if (this.slot) {
      return this.#getSigNativeTimelockPolicy();
    } else if (this.useAllScripts) {
      return this.#getSigNativeWithAllScripts();
    }
    return this.#getSigNativeScript();
  }

  getMintingPolicy() {
    return this.mintingPolicy;
  }

  #getSigNativeScript() {
    var scriptPubkey = LCore.Ed25519KeyHash.from_hex(this.pubKeyHash);
    var sigMatches = LCore.ScriptPubkey.new(scriptPubkey);
    var sigNativeScript = LCore.NativeScript.new_script_pubkey(sigMatches);

    return {
      type: "Native",
      policyID: toHex(sigNativeScript.hash().to_bytes()),
      script: toHex(sigNativeScript.to_bytes()),
      scriptObj: sigNativeScript
    }
  }

  #getSigNativeWithAllScripts() {
    var policyNativeScripts = LCore.NativeScripts.new();
    policyNativeScripts.add(this.#getSigNativeScript().scriptObj);
    var policyAllScripts = LCore.ScriptAll.new(policyNativeScripts);
    var policyScript = LCore.NativeScript.new_script_all(policyAllScripts);

    return {
      type: "Native",
      policyID: toHex(policyScript.hash().to_bytes()),
      script: toHex(policyScript.to_bytes()),
      scriptObj: policyScript
    }
  }

  #getSigNativeTimelockPolicy() {
    var policyNativeScripts = LCore.NativeScripts.new();

    var beforeTimelockSlot = LCore.BigNum.from_str(this.slot.toString());
    var beforeTimelock = LCore.TimelockExpiry.new(beforeTimelockSlot);
    var beforeNativeScript = LCore.NativeScript.new_timelock_expiry(beforeTimelock);
    policyNativeScripts.add(beforeNativeScript);

    policyNativeScripts.add(this.#getSigNativeScript().scriptObj);

    var policyAllScripts = LCore.ScriptAll.new(policyNativeScripts);
    var policyScript = LCore.NativeScript.new_script_all(policyAllScripts);

    return {
      type: "Native",
      policyID: toHex(policyScript.hash().to_bytes()),
      script: toHex(policyScript.to_bytes()),
      scriptObj: policyScript
    }
  }

}
