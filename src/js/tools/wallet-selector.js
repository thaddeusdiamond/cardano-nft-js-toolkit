export const MAINNET = 1;
export const TESTNET = 0;

var SelectedWallet = undefined;
var ConnectedBannerEl = undefined;

export function getConnectedWallet() {
  return SelectedWallet;
}

export function setConnectedWallet(walletName) {
  SelectedWallet = walletName;
}

export function getConnectedBannerEl() {
  return ConnectedBannerEl;
}

export function setConnectedBannerEl(element) {
  ConnectedBannerEl = element;
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

export function enableWallet(walletName) {
  return window.cardano[walletName].enable();
}

function displayWallet() {
  if (isWalletConnected() && getConnectedBannerEl()) {
    document.querySelector(getConnectedBannerEl()).textContent = `Connected to ${getConnectedWallet()}!`;
  }
}

export function isWalletConnected() {
  return SelectedWallet !== undefined;
}

function toastWalletError(error) {
    Toastify({
      text: `Wallet error occurred: ${JSON.stringify(error)}`,
      duration: 3000
    }).showToast()
}

export function buildDropdownDom(containerEl) {
  document.querySelector(containerEl).innerHTML = `<ul>
    <li>
      <a id="connect-wallet" class="text-reset bordered">Connect Wallet&nbsp;&#9660;</a>
      <ul class="dropdown">
        <li class="bordered">
          <a id="connect-nami"><img src="https://namiwallet.io/favicon-32x32.png" width=20 height=20 />&nbsp;&nbsp;Nami</a>
        </li>
        <li class="bordered">
          <a id="connect-eternl"><img src="https://ccvault.io/icons/favicon-128x128.png" width=20 height=20/>&nbsp;&nbsp;Eternl</a>
        </li>
        <li class="bordered">
          <a id="connect-flint"><img src="https://flint-wallet.com/favicon.png" width=20 height=20 />&nbsp;&nbsp;Flint</a>
        </li>
        <li class="bordered">
          <a id="connect-gero"><img src="https://gerowallet.io/assets/img/logo2.ico" width=20 height=20 />&nbsp;&nbsp;Gero</a>
        </li>
        <li class="bordered">
          <a id="connect-typhon"><img src="https://typhonwallet.io/assets/typhon.svg" width=20 height=20 />&nbsp;&nbsp;Typhon</a>
        </li>
      </ul>
    </li>
  </ul>`;
}

export function configureDropdownListeners() {
  setConnectedBannerEl('#connect-wallet');
  document.querySelector("#connect-nami").addEventListener("click", e => connectWallet(e, 'nami'));
  document.querySelector("#connect-eternl").addEventListener("click", e => connectWallet(e, 'eternl'));
  document.querySelector("#connect-flint").addEventListener("click", e => connectWallet(e, 'flint'));
  document.querySelector("#connect-gero").addEventListener("click", e => connectWallet(e, 'gerowallet'));
  document.querySelector("#connect-typhon").addEventListener("click", e => connectWallet(e, 'typhoncip30'));
}
