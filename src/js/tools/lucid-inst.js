import {Lucid, Blockfrost} from "lucid-cardano";

import * as Selector from "./wallet-selector.js";

const lucidNetworkNames = ['Testnet', 'Mainnet'];

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

export function getLucidInstance(blockfrostMain, blockfrostTest) {
  if (!Selector.isWalletConnected()) {
    console.log("Cannot initialize Lucid without knowing network and no wallets detected");
    return;
  }

  return getNetworkId().then(networkId => {
    var lucidParams = {}
    if (networkId == Selector.MAINNET) {
        lucidParams.api = 'https://cardano-mainnet.blockfrost.io/api/v0'
        lucidParams.project = blockfrostMain
        lucidParams.network = 'Mainnet'
    } else if (networkId == Selector.TESTNET) {
        lucidParams.api = 'https://cardano-testnet.blockfrost.io/api/v0'
        lucidParams.project = blockfrostTest
        lucidParams.network = 'Testnet'
    }

    if (!lucidParams.project.startsWith(lucidNetworkNames[networkId].toLowerCase())) {
      return undefined;
    }

    return Lucid.new(
      new Blockfrost(lucidParams.api, lucidParams.project),
      lucidParams.network
    );
  })
}
