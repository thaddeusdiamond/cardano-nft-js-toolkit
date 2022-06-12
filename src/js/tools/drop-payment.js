import * as Selector from "./wallet-selector.js";
import * as LucidInst from "./lucid-inst.js";

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

function toastPaymentError(message) {
  Toastify({ text: message, duration: 3000 }).showToast();
}

export function mintNow(e, blockfrostKey, paymentAddr, price, rebate) {
  e.preventDefault();
  if (!Selector.isWalletConnected()) {
    toastPaymentError('Please connect a wallet before minting using "Connect Wallet" button (desktop only)');
    return;
  }

  Selector.enableWallet(Selector.getConnectedWallet()).then(wallet => {
    var lucidInst = LucidInst.getLucidInstance(blockfrostKey);
    if (!lucidInst) {
      toastPaymentError('Unable to initialize Lucid, check your secrets.js file for a network mismatch');
      return;
    }

    lucidInst.then(lucid => {
      lucid.selectWallet(wallet);
      var paymentAmount =  (getCurrentCount() * price) + rebate;
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
                      .catch(err => toastPaymentError(`Transaction error occurred: ${JSON.stringify(err)}`));
    });
  });
}
