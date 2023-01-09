import {Lucid, Blockfrost} from "lucid-cardano";

import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";

import {shortToast} from "../third-party/toastify-utils.js";

const TESTNET_ID = 0;
const MAINNET_ID = 1;

const PREPROD = 'preprod';
const PREVIEW = 'preview';
const TESTNET = 'testnet';
const MAINNET = 'mainnet';
const LUCID_NETWORK_NAMES = [[PREPROD, PREVIEW, TESTNET], [MAINNET]];

export function getLucidInstance(blockfrostKey) {
  const blockfrostParams = getBlockfrostParams(blockfrostKey);
  return Lucid.new(new Blockfrost(blockfrostParams.api, blockfrostKey), blockfrostParams.network);
}

export function getNetworkId() {
  var cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
  if (!cardanoDApp.isWalletConnected()) {
    return undefined;
  }
  return cardanoDApp.getConnectedWallet().then(wallet => {
    return wallet.getNetworkId().then(networkId => {
      if (networkId != MAINNET_ID && networkId != TESTNET_ID) {
          shortToast(`Invalid networkId ${networkId} detected`);
          return;
      }
      return networkId;
    });
  });
}

export function getBlockfrostParams(blockfrostKey) {
  const blockfrostKeyMarker = blockfrostKey.toLowerCase().slice(0, 7);
  if (blockfrostKeyMarker === MAINNET) {
    return {
      api: 'https://cardano-mainnet.blockfrost.io/api/v0',
      network: 'Mainnet'
    }
  } else if (blockfrostKeyMarker === PREPROD) {
      return {
        api: 'https://cardano-preprod.blockfrost.io/api/v0',
        network: 'Preprod'
      }
  } else if (blockfrostKeyMarker === PREVIEW) {
      return {
        api: 'https://cardano-preview.blockfrost.io/api/v0',
        network: 'Preview'
      }
  } else if (blockfrostKeyMarker === TESTNET) {
      return {
        api: 'https://cardano-testnet.blockfrost.io/api/v0',
        network: 'Testnet'
      }
  }
  throw `Unknown blockfrost key used: ${blockfrostKey}`;
}
