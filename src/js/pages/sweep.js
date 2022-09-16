import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";
import * as Marketplaces from "../third-party/marketplaces.js";

import {coreToUtxo, fromHex, toHex, C as LCore, TxComplete} from "lucid-cardano";

const MSG_ID = '674';
const MSG_KEY = 'msg';
const MAX_METADATA_LEN = 64;
const TX_HASH_LENGTH = 64;
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
  const txHash = await txSigned.submit();
  if (txHash.length !== TX_HASH_LENGTH) {
    throw txHash;
  }
  return { txSigned: txSigned.txSigned, txHash: txHash };
}

function datumToHash(bytes) {
  const plutusHash = LCore.hash_plutus_data(LCore.PlutusData.from_bytes(bytes));
  return plutusHash.to_hex();
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

  if (txn.redeemedUtxos !== undefined) {
    for (const redeemedUtxo of txn.redeemedUtxos) {
      if (!redeemedUtxo.utxo.datumHash || !redeemedUtxo.utxo.datumSchema) {
        throw `Redeemed UTxO lacking hash or schema type for calculating redemption ${redeemedUtxo}`;
      }

      const datum = fromHex(Marketplaces.datumFor(redeemedUtxo.utxo.datumSchema, txn.id, txn.payees))
      const computedHash = datumToHash(datum);
      if (redeemedUtxo.utxo.datumHash !== computedHash) {
        throw `Expected ${redeemedUtxo.utxo.datumHash}, found ${computedHash}`;
      }

      redeemedUtxo.utxo.datum = datum;
      txBuilder = txBuilder.collectFrom([redeemedUtxo.utxo], redeemedUtxo.redeemer);
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
  const txHash = await txSigned.submit();
  if (txHash.length !== TX_HASH_LENGTH) {
    throw txHash;
  }

  return { txSigned: txSigned.txSigned, txHash: txHash };
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
      window.postMessage({ type: "WT_SWEEP_READY", utxoHash: txHash, wallet: walletInfo }, "*");
      return;
    }
  }
  setTimeout(async _ => await waitForTxn(blockfrostKey, txHash), UTXO_WAIT_TIMEOUT);
}

function bigIntStringify(obj) {
  return JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint'
          ? value.toString()
          : value // return everything else unchanged
  );
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
      const totalTxns = message.params.txns.length;
      const wallet = await cardanoDAppWallet();
      const lucid = await connectedLucidInst(message.params.blockfrostKey, wallet);
      try {
        const feeTx = await executeTxn(lucid, message.params.feeTxn);
        window.postMessage({
          type: "WT_FEE_COMPLETE",
          feeTxn: message.params.feeTxn,
          txHash: feeTx.txHash
        });
        var currTxn = 0;
        for (const txn of message.params.txns) {
          currTxn++;
          try {
            window.postMessage({
              type: "WT_TXN_START",
              order: txn.order,
              index: currTxn,
              total: totalTxns
            });
            const txComplete = await executeTxn(lucid, txn);
            const witnessSet = toHex(txComplete.txSigned.witness_set().to_bytes());
            window.postMessage({
              type: "WT_TXN_COMPLETE",
              order: txn.order,
              witnessSet: witnessSet,
              txHash: txComplete.txHash,
              index: currTxn,
              total: totalTxns
            });
            completedTxns++;
          } catch (err) {
            window.postMessage({
              type: "WT_TXN_ERROR",
              order: txn.order,
              err: err,
              index: currTxn,
              total: totalTxns
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
