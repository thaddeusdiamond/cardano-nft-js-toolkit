import * as Secrets from "../secrets.js";
import * as Selector from "./wallet-selector.js";
import * as LucidInst from "./lucid-inst.js";

function updateMintCount(count) {
  var boundedCount = Math.max(Secrets.LOWER_LIMIT, Math.min(Secrets.UPPER_LIMIT, count));
  document.querySelector("#mint-count").value = boundedCount
}

function getCurrentCount() {
  return parseInt(document.querySelector("#mint-count").value);
}

export function decreaseMintCount(e) {
  e.preventDefault()
  updateMintCount(getCurrentCount() - 1);
}

export function increaseMintCount(e) {
  e.preventDefault();
  updateMintCount(getCurrentCount() + 1);
}

export function validateMintCount(e) {
  updateMintCount(getCurrentCount());
}

function getPaymentAddress() {
  return LucidInst.getNetworkId().then(networkId => {
    if (networkId == Selector.MAINNET) {
      return Secrets.MAIN_PAYMENT_ADDR;
    }
    return Secrets.TEST_PAYMENT_ADDR;
  });
}

function toastTransactionError(error) {
    Toastify({
      text: `Transaction error occurred: ${JSON.stringify(error)}`,
      duration: 3000
    }).showToast()
}

export function mintNow(e) {
  e.preventDefault();
  if (!Selector.isWalletConnected()) {
    Toastify({
        text: `Please connect a wallet before minting using "Connect Wallet" button (desktop only)`,
        duration: 3000
    }).showToast()
    return;
  }

  Selector.enableWallet(Selector.getConnectedWallet()).then(wallet => {
    LucidInst.getLucidInstance(Secrets.MAIN_BLOCKFROST_PROJ, Secrets.TEST_BLOCKFROST_PROJ).then(lucid => {
      getPaymentAddress().then(paymentAddress => {
          lucid.selectWallet(wallet);
          var paymentAmount =  (getCurrentCount() * Secrets.MINT_PRICE) + Secrets.MINT_REBATE;
          const tx = lucid.newTx()
                          .payToAddress(paymentAddress, { lovelace: paymentAmount })
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
                          .catch(toastTransactionError);
      });
    });
  });
}
