import {CardanoDApp} from "cardano-dapp-js";

import {validate, validated} from "../nft-toolkit/utils.js";

var cardanoDApp;

export function initializeCardanoDApp(containerId, walletConnectInfo) {
  validate(!cardanoDApp, 'Illegal state, attempting to initialize cardano DApp twice');
  cardanoDApp = new CardanoDApp(containerId, walletConnectInfo);
}

export function getCardanoDAppInstance() {
  return validated(cardanoDApp, 'Illegal state, initialize CardanoDApp before retrieval');
}
