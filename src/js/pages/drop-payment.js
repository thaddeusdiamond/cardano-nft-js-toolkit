import * as CardanoDApp from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";

import {shortToast, longToast} from "../third-party/toastify-utils.js";

const MINT_COUNT_DOM = "#mint-count";

function updateMintCount(count, lowerLimit, upperLimit) {
  var boundedCount = Math.max(lowerLimit, Math.min(upperLimit, count));
  document.querySelector(MINT_COUNT_DOM).value = boundedCount;
}

function getCurrentCount() {
  return parseInt(document.querySelector(MINT_COUNT_DOM).value);
}

export function decreaseMintCount(e, lowerLimit, upperLimit) {
  e.preventDefault();
  updateMintCount(getCurrentCount() - 1, lowerLimit, upperLimit);
}

export function increaseMintCount(e, lowerLimit, upperLimit) {
  e.preventDefault();
  updateMintCount(getCurrentCount() + 1, lowerLimit, upperLimit);
}

export function validateMintCount(e, lowerLimit, upperLimit) {
  updateMintCount(getCurrentCount(), lowerLimit, upperLimit);
}

export function mintNow(e, blockfrostKey, paymentAddr, price) {
  e.preventDefault();
  var cardanoDApp = CardanoDApp.getCardanoDAppInstance();
  if (!cardanoDApp.isWalletConnected()) {
    shortToast('Please connect a wallet before minting using "Connect Wallet" button (desktop only)');
    return;
  }

  cardanoDApp.getConnectedWallet().then(wallet => {
    var lucidInst = LucidInst.getLucidInstance(blockfrostKey);
    if (!lucidInst) {
      shortToast('Unable to initialize Lucid, check your secrets.js file for a network mismatch');
      return;
    }

    lucidInst.then(lucid => {
      lucid.selectWallet(wallet);
      var paymentAmount = getCurrentCount() * price;
      const tx = lucid.newTx()
                      .payToAddress(paymentAddr, { lovelace: paymentAmount })
                      .complete()
                      .then(tx =>
                          tx.sign().complete().then(signedTx =>
                            signedTx.submit().then(txHash =>
                              Toastify({
                                text: `Successfully sent money for minting in tx: ${txHash}`,
                                duration: 6000
                              }).showToast()
                            )
                          )
                      )
                      .catch(err => shortToast(`Transaction error occurred: ${JSON.stringify(err)}`));
    }).catch(_ => shortToast('Wallet initialization failed (are you on the right network?)'));
  }).catch(err => shortToast(`Unknown error occurred, contact developer: ${err}`));
}
