import {Lucid, Blockfrost} from "lucid-cardano";

import * as Selector from "./wallet-selector.js";

const lucidNetworkNames = ['testnet', 'mainnet'];

export function getNetworkId() {
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

export function getLucidInstance(blockfrostKey) {
  if (!Selector.isWalletConnected()) {
    console.log("Cannot initialize Lucid without knowing network and no wallets detected");
    return;
  }

  return getNetworkId().then(networkId => {
    var lucidApi;
    var lucidNetwork;
    if (networkId == Selector.MAINNET) {
        lucidApi = 'https://cardano-mainnet.blockfrost.io/api/v0';
        lucidNetwork = 'Mainnet';
    } else if (networkId == Selector.TESTNET) {
        lucidApi = 'https://cardano-testnet.blockfrost.io/api/v0';
        lucidNetwork = 'Testnet';
    } else {
      throw `Unknown network ID returned by lucid: ${networkId}`;
    }

    if (!blockfrostKey.startsWith(lucidNetworkNames[networkId])) {
      return undefined;
    }

    return Lucid.new(new Blockfrost(lucidApi, blockfrostKey), lucidNetwork);
  })
}
