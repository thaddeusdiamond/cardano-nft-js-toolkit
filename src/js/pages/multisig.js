import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";
import * as NftPolicy from "../nft-toolkit/nft-policy.js";
import * as Secrets from "../secrets.js";

import {toHex} from "lucid-cardano";

import {longToast} from "../third-party/toastify-utils.js";
import {validate, validated} from "../nft-toolkit/utils.js";

async function createTxBuilder(assetName, nftPolicy, metadata, payees) {
  const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
  validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before minting using "Connect Wallet" button');

  const assetNameHex = `${nftPolicy.policyID}${toHex(new TextEncoder().encode(assetName))}`
  const mintAssets = { [assetNameHex]: 1n };

  const wallet = await cardanoDApp.getConnectedWallet();
  const lucid = validated(await LucidInst.getLucidInstance(Secrets.TEST_BLOCKFROST_PROJ), 'This dApp is only supported on testnet');
  lucid.selectWallet(wallet);
  const address = await lucid.wallet.address();
  const txBuilder = lucid.newTx()
                       .attachMintingPolicy(nftPolicy.getMintingPolicy())
                       .attachMetadata(NftPolicy.METADATA_KEY, metadata)
                       .mintAssets(mintAssets)
                       .payToAddress(address, mintAssets);
  if (nftPolicy.slot && nftPolicy.slot > 0) {
    txBuilder.validTo(lucid.utils.slotToUnixTime(nftPolicy.slot));
  }
  for (const payee in payees) {
    txBuilder.payToAddress(payee, payees[payee]);
  }
  return txBuilder;
}

export async function partialSignForUser(assetName, nftPolicy, metadata, payees) {
  try {
    const txBuilder = await createTxBuilder(assetName, nftPolicy, metadata, payees);
    const txComplete = await txBuilder.complete();
    const partialSignedTx = await txComplete.partialSign();
    longToast(`Successfully performed the user portion of the multi-sig mint!`);
    return partialSignedTx;
  } catch (err) {
    longToast(`An error occurred during user portion of multi-sig: ${JSON.stringify(err)}`);
    throw err;
  }
}

export async function completePartiallySignedTxn(assetName, nftPolicy, metadata, payees, txnWitnesses, policySKey) {
  try {
    const txBuilder = await createTxBuilder(assetName, nftPolicy, metadata, payees);
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
