import * as CardanoDAppJs from "../third-party/cardano-dapp-js.js";
import * as LucidInst from "../third-party/lucid-inst.js";
import * as Marketplaces from "../third-party/marketplaces.js";

import {coreToUtxo, fromHex, toHex, C as LCore, TxComplete} from "lucid-cardano";

import {validated} from "../nft-toolkit/utils.js";

const MSG_ID = '674';
const MSG_KEY = 'msg';
const MAX_METADATA_LEN = 64;
const TX_HASH_LENGTH = 64;
const UTXO_WAIT_TIMEOUT = 30000;

export async function cardanoDAppWallet() {
  var cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
  if (!cardanoDApp.isWalletConnected()) {
    throw 'Please connect a wallet using the "Connect Wallet" button in the toolbar';
  }
  return await cardanoDApp.getConnectedWallet();
}

export async function connectedLucidInst(blockfrostKey, wallet) {
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

export async function getWalletInfo(wallet, lucid) {
  const walletUtxos = await wallet.getUtxos();
  const utxos = new Map(
    walletUtxos.map(utxo => {
      const parsedUtxo = LCore.TransactionUnspentOutput.from_bytes(fromHex(utxo));
      return [utxo, coreToUtxo(parsedUtxo)];
    })
  );

  const addressDetails = await lucid.utils.getAddressDetails(await lucid.wallet.address());
  const stakeAddress = await lucid.utils.credentialToRewardAddress(addressDetails.stakeCredential);
  return {
    address: validated(addressDetails.address?.bech32, 'Wallet error, missing payment address'),
    stakeAddress: validated(stakeAddress, 'Wallet error, missing stake address'),
    collateral: await wallet.experimental.getCollateral(),
    utxos: utxos
  }
}

export async function executeCborTxn(lucid, txn) {
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

      const datum = fromHex(Marketplaces.datumFor(redeemedUtxo.utxo, txn.id, txn.payees))
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

export async function waitForTxn(blockfrostKey, txHash) {
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

function bifurcatedTokenGateMap(params) {
  if (params.tokenGateMap === undefined) {
    return { [params.requiredPolicy]: params.minAssets }
  }
  return params.tokenGateMap;
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
        const tokenGateMap = bifurcatedTokenGateMap(message.params);
        const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
        const isAuthorized = await cardanoDApp.walletMeetsTokenGate(tokenGateMap);
        if (!isAuthorized) {
          throw `The sweeper currently requires 4 WildTangz NFTs to be used!`;
        }

        const wallet = await cardanoDAppWallet();
        const lucid = await connectedLucidInst(message.params.blockfrostKey, wallet);
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
      const buyer = await lucid.wallet.address();
      try {
        var currTxn = 0;
        for (const txn of message.params.txns) {
          currTxn++;
          try {
            window.postMessage({
              type: "WT_TXN_START",
              buyer: buyer,
              order: txn.order,
              index: currTxn,
              total: totalTxns
            });
            const txComplete = await executeTxn(lucid, txn);
            const witnessSet = toHex(txComplete.txSigned.witness_set().to_bytes());
            window.postMessage({
              type: "WT_TXN_COMPLETE",
              buyer: buyer,
              order: txn.order,
              index: currTxn,
              total: totalTxns,
              witnessSet: witnessSet,
              txHash: txComplete.txHash
            });
            completedTxns++;
          } catch (err) {
            window.postMessage({
              type: "WT_TXN_ERROR",
              buyer: buyer,
              order: txn.order,
              index: currTxn,
              total: totalTxns,
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
