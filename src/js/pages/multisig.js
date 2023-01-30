import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";
import * as NftPolicy from "../nft-toolkit/nft-policy.js";
import * as Secrets from "../secrets.js";

import {C as LCore, toHex} from "lucid-cardano";

import {longToast} from "../third-party/toastify-utils.js";
import {Utils, validate, validated} from "../nft-toolkit/utils.js";

export async function instantiatedLucid(blockfrostKey) {
  const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
  validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before minting using "Connect Wallet" button');
  const wallet = await cardanoDApp.getConnectedWallet();
  const lucid = validated(await LucidInst.getLucidInstance(blockfrostKey), 'Blockfrost key mismatch with wallet');
  lucid.selectWallet(wallet);
  return lucid;
}

async function createTxBuilder(assetName, recipient, nftPolicy, metadata, payees, blockfrostKey) {
  const lucid = await instantiatedLucid(blockfrostKey);
  const assetNameHex = `${nftPolicy.policyID}${toHex(new TextEncoder().encode(assetName))}`
  const mintAssets = { [assetNameHex]: 1n };

  const txBuilder = lucid.newTx()
                       .attachMintingPolicy(nftPolicy.getMintingPolicy())
                       .attachMetadata(NftPolicy.METADATA_KEY, metadata)
                       .mintAssets(mintAssets)
                       .payToAddress(recipient, mintAssets);
  if (nftPolicy.slot && nftPolicy.slot > 0) {
    txBuilder.validTo(lucid.utils.slotToUnixTime(nftPolicy.slot));
  }
  for (const payee in payees) {
    txBuilder.payToAddress(payee, payees[payee]);
  }
  return txBuilder;
}

export async function partialSignForUser(assetName, recipient, nftPolicy, metadata, payees, blockfrostKey) {
  try {
    const txBuilder = await createTxBuilder(assetName, recipient, nftPolicy, metadata, payees, blockfrostKey);
    const txComplete = await txBuilder.complete();
    const partialSignedTx = await txComplete.partialSign();
    longToast(`Successfully performed your portion of the mint! An authorized counterparty now needs to sign it...`);
    return { witnesses: partialSignedTx, body: toHex(txComplete.txComplete.to_bytes())};
  } catch (err) {
    longToast(`An error occurred during user portion of multi-sig: ${JSON.stringify(err)}`);
    throw err;
  }
}

export async function completePartiallySignedTxn(assetName, recipient, nftPolicy, metadata, payees, txnWitnesses, policySKey, blockfrostKey) {
  try {
    const txBuilder = await createTxBuilder(assetName, recipient, nftPolicy, metadata, payees, blockfrostKey);
    const txComplete = await txBuilder.complete();
    const txSigned = await txComplete.assemble(txnWitnesses).signWithPrivateKey(policySKey.to_bech32()).complete();
    const txSubmit = await txSigned.submit();
    longToast(`Successfully performed the policy portion of the multi-sig mint! (${txSubmit})`);
    return txSubmit;
  } catch (err) {
    longToast(`An error occurred during policy portion of multi-sig: ${JSON.stringify(err)}`);
    throw err;
  }
}

export function duplicateTxnWithSecretMetadata(transaction, hexStr) {
  const metadataHash = LCore.AuxiliaryDataHash.from_hex(hexStr);
  const bodyClone = transaction.body();
  bodyClone.set_auxiliary_data_hash(metadataHash);
  return LCore.Transaction.new(bodyClone, transaction.witness_set(), undefined);
}
