import * as secrets from "./mint-secrets.js";
import {Lucid, Blockfrost} from "lucid-cardano";

const MAINNET = 1;
const TESTNET = 0;

var SelectedWallet = undefined;
var ConnectedBannerEl = undefined;

function getConnectedWallet() {
  return SelectedWallet;
}

function setConnectedWallet(walletName) {
  SelectedWallet = walletName;
}

function getConnectedBannerEl() {
  return ConnectedBannerEl;
}

export function setConnectedBannerEl(element) {
  ConnectedBannerEl = element;
}

function isWalletConnected() {
  return SelectedWallet !== undefined;
}

function isWalletSupported(walletName) {
  if (!(("cardano" in window) && (walletName in window.cardano))) {
    Toastify({
      text: `Wallet '${walletName}' not integrated in your browser`,
      duration: 3000
    }).showToast();
    return false;
  }
  return true;
}

function enableWallet(walletName) {
  return window.cardano[walletName].enable();
}

function displayWallet() {
  if (isWalletConnected() && getConnectedBannerEl()) {
    document.querySelector(getConnectedBannerEl()).textContent = `Connected to ${getConnectedWallet()}!`;
  }
}

function getNetworkId() {
  if (!isWalletConnected()) {
    return undefined;
  }
  return enableWallet(getConnectedWallet()).then(wallet => {
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
  if (!isWalletConnected()) {
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

export function connectWallet(e, walletName) {
  e.preventDefault();
  if (!isWalletSupported(walletName)) {
    return;
  }

  enableWallet(walletName).then(wallet =>
    wallet.getChangeAddress().then(address => {
      setConnectedWallet(walletName);
      displayWallet();
      Toastify({
          text: `Successfully connected wallet ${address}!`,
          duration: 3000
      }).showToast();
    })
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
  if (!isWalletConnected()) {
    Toastify({
        text: `Please connect a wallet before minting using "Connect Wallet" button (desktop only)`,
        duration: 3000
    }).showToast()
    return;
  }

  enableWallet(getConnectedWallet()).then(wallet => {
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
