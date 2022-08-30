import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";

import {coreToUtxo, fromHex, toHex, C as LCore, TxComplete} from "lucid-cardano";
import {JpgStore} from "../third-party/jpgstore.js";

const MSG_ID = '674';
const MSG_KEY = 'msg';
const MAX_METADATA_LEN = 64;
const UTXO_WAIT_TIMEOUT = 30;

function numRequiredPolicyAssets(requiredPolicy, availableUtxos) {
  const requiredAssets = {};
  for (const availableUtxo of availableUtxos) {
    const assets = availableUtxo.assets;
    for (const asset in assets) {
      if (asset.startsWith(requiredPolicy)) {
        requiredAssets[asset] = assets[asset];
      }
    }
  }
  return Object.values(requiredAssets).reduce((acc, amount) => acc + amount, 0n);
}

async function cardanoDAppWallet() {
  var cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
  if (!cardanoDApp.isWalletConnected()) {
    throw 'Please connect a wallet before sweeping using "Connect Wallet" button';
  }
  return await cardanoDApp.getConnectedWallet();
}

async function connectedLucidInst(blockfrostKey, wallet) {
  const lucid = await LucidInst.getLucidInstance(blockfrostKey);
  if (lucid === undefined) {
    throw 'Please validate that your wallet is on mainnet';
  }
  if (lucid.network !== 'Mainnet') {
    throw 'Internal error (NETWORK) please contact devs';
  }
  lucid.selectWallet(wallet);
  return lucid;
}

async function validateHoldings(lucid, requiredPolicy, minAssets) {
  const address = await lucid.wallet.address();
  const availableUtxos = await lucid.wallet.getUtxos();
  const numPolicyAssets = numRequiredPolicyAssets(requiredPolicy, availableUtxos);
  if (numPolicyAssets < minAssets) {
    throw `The sweeper currently requires ${minAssets} NFTs with policy ID ${requiredPolicy} to be used!`;
  }
}

async function getWalletInfo(wallet, lucid) {
  const walletUtxos = await wallet.getUtxos();
  const utxos = new Map(
    walletUtxos.map(utxo => {
      const parsedUtxo = LCore.TransactionUnspentOutput.from_bytes(fromHex(utxo));
      return [utxo, coreToUtxo(parsedUtxo)];
    })
  );
  return {
    address: await lucid.wallet.address(),
    collateral: await wallet.experimental.getCollateral(),
    utxos: utxos
  }
}

async function executeCborTxn(lucid, txn) {
  const txnBytes = fromHex(txn.txn.cbor);
  const txnFromCbor = LCore.Transaction.from_bytes(txnBytes);
  var txComplete = new TxComplete(lucid, txnFromCbor);
  var txSigned = await txComplete.sign().complete();
  return { txSigned: txSigned.txSigned, txHash: await txSigned.submit() };
}

async function executePayToTxn(lucid, txn) {
  const lucidUtxos = txn.utxos.map(utxo => {
    const utxoBytes = fromHex(utxo);
    const utxoCore = LCore.TransactionUnspentOutput.from_bytes(utxoBytes);
    return coreToUtxo(utxoCore);
  });

  const buyerAddress = await lucid.wallet.address();
  var txBuilder = lucid.newTx().addSigner(buyerAddress).collectFrom(lucidUtxos);

  if (txn.receipt !== undefined) {
    const receiptMetadata = txn.receipt.match(new RegExp(`.{1,${MAX_METADATA_LEN}}`, 'g'));
    txBuilder = txBuilder.attachMetadata(MSG_ID, { [MSG_KEY]: receiptMetadata });
  }

  if (txn.orders !== undefined) {
    for (const order of txn.orders) {
      // TODO: Multi-marketplace support breaks down here
      const inputUtxo = await JpgStore.getInputUtxo(order.metadata, order.payees, lucid);
      const redeemer = await JpgStore.getRedeemer(order.metadata, order.payees, lucid);
      txBuilder = txBuilder.collectFrom([inputUtxo], redeemer);
      for (const payee of Object.values(order.payees)) {
        txBuilder = txBuilder.payToAddress(payee.addr, {[payee.token]: payee.amount});
      }
    }
  }

  if (txn.fee !== undefined) {
    txBuilder = txBuilder.payToAddress(txn.fee.addr, {[txn.fee.token]: txn.fee.amount});
  }

  if (txn.payees !== undefined) {
    for (const payee of txn.payees) {
      txBuilder = txBuilder.payToAddress(payee.addr, {[payee.token]: payee.amount});
    }
  }

  if (txn.spendingValidator !== undefined) {
    txBuilder = txBuilder.attachSpendingValidator(txn.spendingValidator);
  }

  if (txn.ttl !== undefined) {
    txBuilder = txBuilder.validTo(Date.now() + txn.ttl);
  }

  const txComplete = await txBuilder.complete();
  const txSigned = await txComplete.sign().complete();
  return { txSigned: txSigned.txSigned, txHash: await txSigned.submit() };
}

async function executeTxn(lucid, txn) {
  if (txn.type === 'pay_to_address') {
    return executePayToTxn(lucid, txn);
  } else if (txn.type === 'sweep_txn_type') {
    return executeCborTxn(lucid, txn);
  }
  throw `Unrecognized txn: ${JSON.stringify(txn)}`;
}

async function waitForTxn(blockfrostKey, txHash) {
  const wallet = await cardanoDAppWallet();
  const lucid = await connectedLucidInst(blockfrostKey, wallet);
  const walletInfo = await getWalletInfo(wallet, lucid);
  for (const utxo of walletInfo.utxos.values()) {
    if (utxo.txHash === txHash) {
      window.postMessage({ type: "WT_SWEEP_READY", wallet: walletInfo }, "*");
      return;
    }
  }
  setTimeout(async _ => await waitForTxn(blockfrostKey, txHash), UTXO_WAIT_TIMEOUT);
}

export async function processMessageData(message) {
  switch (message.type) {
    case "WT_LOAD_PREP":
      var walletInfo;
      try {
        const wallet = await cardanoDAppWallet();
        const lucid = await connectedLucidInst(message.params.blockfrostKey, wallet);
        walletInfo = await getWalletInfo(wallet, lucid);
      } catch (err) {
        walletInfo = { utxos: new Map() }
      }
      window.postMessage({ type: "WT_LOAD_READY", wallet: walletInfo }, "*");
      break;
    case "WT_START_SWEEP":
      try {
        const wallet = await cardanoDAppWallet();
        const lucid = await connectedLucidInst(message.params.blockfrostKey, wallet);
        await validateHoldings(lucid, message.params.requiredPolicy, message.params.minAssets);
        const walletInfo = await getWalletInfo(wallet, lucid);
        window.postMessage({ type: "WT_WALLET_READY", wallet: walletInfo }, "*");
      } catch (err) {
        window.postMessage({ type: "WT_WALLET_ERROR", err: err }, "*");
      }
      break;
    case "WT_SEND_TO_SELF":
      try {
        const wallet = await cardanoDAppWallet();
        const lucid = await connectedLucidInst(message.params.blockfrostKey, wallet);
        const txComplete = await executeTxn(lucid, message.params.self_txn);
        window.postMessage({ type: "WT_SEND_SELF_COMPLETE", txHash: txComplete.txHash }, "*");
        await waitForTxn(message.params.blockfrostKey, txComplete.txHash);
      } catch (err) {
        window.postMessage({ type: "WT_SEND_TO_SELF_FAIL", err: err }, "*");
      }
      break;
    case "WT_PERFORM_TXNS":
      var completedTxns = 0;
      const wallet = await cardanoDAppWallet();
      const lucid = await connectedLucidInst(message.params.blockfrostKey, wallet);
      try {
        const feeTx = await executeTxn(lucid, message.params.feeTxn);
        window.postMessage({
          type: "WT_FEE_COMPLETE",
          feeTxn: message.params.feeTxn,
          txHash: feeTx.txHash
        });
        for (const txn of message.params.txns) {
          try {
            const txComplete = await executeTxn(lucid, txn);
            const witnessSet = toHex(txComplete.txSigned.witness_set().to_bytes());
            window.postMessage({
              type: "WT_TXN_COMPLETE",
              order: txn.order,
              witnessSet: witnessSet,
              txHash: txComplete.txHash
            });
            completedTxns += 1;
          } catch (err) {
            window.postMessage({
              type: "WT_TXN_ERROR",
              order: txn.order,
              err: err
            });
            const errMsg = (typeof err === 'string') ? err : JSON.stringify(err);
            if (!confirm(`Transaction cancelled or failed, would you like to continue? (${errMsg})`)) {
              break;
            }
          }
        }
      } catch (err) {
        window.postMessage({
          type: "WT_FEE_ERROR",
          feeTxn: message.params.feeTxn,
          err: err
        });
        var errStr;
        if (typeof err === 'string') {
          errStr = err;
        } else {
          errStr = JSON.stringify(err);
        }
      }
      window.postMessage({ type: "WT_SWEEP_COMPLETE", completed: completedTxns });
      break;
    default:
      //console.log(`Received unknown message of type ${message.type}: ${message.text}`);
      return;
  }
}
