import * as secrets from "./mint-secrets.js";
import {Lucid, Blockfrost} from "lucid-cardano";

const MAINNET = 1;
const TESTNET = 0;

function checkBrowserWallet() {
  // TODO: Multi-wallet support
  if (!(("cardano" in window) && ('nami' in window.cardano))) {
    Toastify({
      text: "Nami integration not found on your browser.",
      duration: 3000
    }).showToast();
    return false;
  }
  return true;
}

function enableWallet() {
  // TODO: Multi-wallet support
  return window.cardano.nami.enable();
}

function getNetworkId() {
  return enableWallet().then(wallet => {
    return wallet.getNetworkId().then(networkId => {
      if (networkId != MAINNET && networkId != TESTNET) {
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
  if (!checkBrowserWallet()) {
    console.log("Cannot initialize Lucid without knowing network and no wallets detected");
    return;
  }

  return getNetworkId().then(networkId => {
    var lucidParams = {}
    if (networkId == MAINNET) {
        lucidParams.api = 'https://cardano-mainnet.blockfrost.io/api/v0'
        lucidParams.project = secrets.MAIN_BLOCKFROST_PROJ
        lucidParams.network = 'Mainnet'
    } else if (networkId == TESTNET) {
        lucidParams.api = 'https://cardano-testnet.blockfrost.io/api/v0'
        lucidParams.project = secrets.TEST_BLOCKFROST_PROJ
        lucidParams.network = 'Testnet'
    }
    return Lucid.new(
      new Blockfrost(lucidParams.api, lucidParams.project),
      lucidParams.network
    );
  })
}

function toastWalletError(error) {
    Toastify({
      text: `Wallet error occurred: ${JSON.stringify(error)}`,
      duration: 3000
    }).showToast()
}

export function connectWallet(e) {
  e.preventDefault();
  if (!checkBrowserWallet()) {
    return;
  }

  enableWallet().then(wallet =>
    wallet.getChangeAddress().then(address =>
      Toastify({
          text: `Successfully connected wallet ${address}!`,
          duration: 3000
      }).showToast()
    )
  ).catch(toastWalletError);
}

function updateMintCount(count) {
  var boundedCount = Math.max(secrets.LOWER_LIMIT, Math.min(secrets.UPPER_LIMIT, count));
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
    if (networkId == MAINNET) {
      return secrets.MAIN_PAYMENT_ADDR;
    }
    return secrets.TEST_PAYMENT_ADDR;
  });
}

export function mintNow(e) {
  e.preventDefault();
  if (!checkBrowserWallet()) {
    return;
  }

  enableWallet().then(wallet => {
    getLucidInstance().then(lucid => {
      getPaymentAddress().then(paymentAddress => {
          lucid.selectWallet(wallet);
          var paymentAmount =  (getCurrentCount() * secrets.MINT_PRICE) + secrets.MINT_REBATE;
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
                          .catch(toastWalletError);
      });
    });
  });
}
