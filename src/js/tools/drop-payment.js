import * as Secrets from "../secrets.js";
import * as Selector from "./wallet-selector.js";
import {Lucid, Blockfrost} from "lucid-cardano";

function getNetworkId() {
  if (!Selector.isWalletConnected()) {
    return undefined;
  }
  return Selector.enableWallet(Selector.getConnectedWallet()).then(wallet => {
    return wallet.getNetworkId().then(networkId => {
      if (networkId != Selector.MAINNET && networkId != Selector.TESTNET) {
          Toastify({
            text: `Invalid networkId ${networkId} detected`,
            duration: 5000
          }).showToast();
          return;
      }
      return networkId;
    });
  });
}

function getLucidInstance() {
  if (!Selector.isWalletConnected()) {
    console.log("Cannot initialize Lucid without knowing network and no wallets detected");
    return;
  }

  return getNetworkId().then(networkId => {
    var lucidParams = {}
    if (networkId == Selector.MAINNET) {
        lucidParams.api = 'https://cardano-mainnet.blockfrost.io/api/v0'
        lucidParams.project = Secrets.MAIN_BLOCKFROST_PROJ
        lucidParams.network = 'Mainnet'
    } else if (networkId == Selector.TESTNET) {
        lucidParams.api = 'https://cardano-testnet.blockfrost.io/api/v0'
        lucidParams.project = Secrets.TEST_BLOCKFROST_PROJ
        lucidParams.network = 'Testnet'
    }
    return Lucid.new(
      new Blockfrost(lucidParams.api, lucidParams.project),
      lucidParams.network
    );
  })
}

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
  return getNetworkId().then(networkId => {
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
    getLucidInstance().then(lucid => {
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
