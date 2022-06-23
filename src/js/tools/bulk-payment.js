import * as Selector from "./wallet-selector.js";
import * as LucidInst from "./lucid-inst.js";

import {shortToast, longToast} from "./toastify-utils.js";
import {validate, validated} from "./utils.js";

const NEWLINE = /\r\n|\n/;

async function readBulkPaymentFile(filesDom) {
  var inputFiles = validated(document.querySelector(filesDom)?.files, 'Internal DOM error, contact developer');
  inputFiles.disabled = true;
  try {
    validate(inputFiles.length == 1, 'Please upload a single file using the input selector');

    var bulkPaymentFile = inputFiles[0];
    shortToast(`Reading bulk payment information from "${bulkPaymentFile.name}"`);

    var readPromise = new Promise((resolve, reject) => {
      var reader = new FileReader();
      reader.onloadend = (event => resolve(event.target.result));
      reader.onerror = (event => reject(event));
      reader.readAsText(bulkPaymentFile);
    });
    var rawText = await readPromise;

    var addressesLovelaces = {}
    for (const line of rawText.split(NEWLINE)) {
      // Empty lines are fine
      if (!line) {
        continue;
      }
      var addressLovelace = line.split(',');
      validate(addressLovelace.length == 2, 'Incorrect file format, aborting!!');
      addressesLovelaces[addressLovelace[0]] = parseInt(addressLovelace[1]);
    }
    return addressesLovelaces;
  } finally {
    inputFiles.disabled = false;
  }
}

export async function generateTransaction(e, blockfrostKeyDom, filesDom) {
  try {
    validate(Selector.isWalletConnected(), 'Please connect a wallet before minting using "Connect Wallet" button');
    var wallet = await Selector.enableWallet(Selector.getConnectedWallet());

    var blockfrostKey = validated(document.querySelector(blockfrostKeyDom).value, 'Please enter your key from blockfrost.io');
    var lucid = validated(await LucidInst.getLucidInstance(blockfrostKey), 'There was an error connecting to blockfrost (is your wallet the right network?)');
    lucid.selectWallet(wallet);

    var addressesLovelaces = await readBulkPaymentFile(filesDom);

    var txBuilder = lucid.newTx();
    for (const address in addressesLovelaces) {
      var amount = addressesLovelaces[address];
      txBuilder = txBuilder.payToAddress(address, {lovelace: amount});
    }

    return txBuilder.complete().then(tx =>
      tx.sign().complete().then(signedTx =>
        signedTx.submit().then(txHash =>
          shortToast(`Successfully submitted bulk payment transaction as ${txHash}!`)
        ).catch(err => shortToast(JSON.stringify(err)))
      ).catch(err => shortToast(JSON.stringify(err)))
    ).catch(err => shortToast(JSON.stringify(err)));
  } catch (err) {
    shortToast(err);
  }
}
