import {Lucid, Blockfrost} from "lucid-cardano";

import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";

const TESTNET = 0;
const MAINNET = 1;
const LUCID_NETWORK_NAMES = ['testnet', 'mainnet'];

export function getLucidInstance(blockfrostKey) {
  var cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
  if (!cardanoDApp.isWalletConnected()) {
    console.log("Cannot initialize Lucid without knowing network and no wallets detected");
    return;
  }

  return getNetworkId().then(networkId => {
    var lucidApi;
    var lucidNetwork;
    if (networkId == MAINNET) {
        lucidApi = 'https://cardano-mainnet.blockfrost.io/api/v0';
        lucidNetwork = 'Mainnet';
    } else if (networkId == TESTNET) {
        lucidApi = 'https://cardano-testnet.blockfrost.io/api/v0';
        lucidNetwork = 'Testnet';
    } else {
      throw `Unknown network ID returned by lucid: ${networkId}`;
    }

    if (!blockfrostKey.startsWith(LUCID_NETWORK_NAMES[networkId])) {
      return undefined;
    }

    return Lucid.new(new Blockfrost(lucidApi, blockfrostKey), lucidNetwork);
  })
}

function getNetworkId() {
  var cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
  if (!cardanoDApp.isWalletConnected()) {
    return undefined;
  }
  return cardanoDApp.getConnectedWallet().then(wallet => {
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
