import {fromHex, C as LCore, Data, Construct} from "lucid-cardano";

import {validate} from "../nft-toolkit/utils.js";

function datumToHash(bytes) {
  const plutusHash = LCore.hash_plutus_data(LCore.PlutusData.from_bytes(bytes));
  return plutusHash.to_hex();
}

export class JpgStore {

  static IGNORE_CURRENCY_NAME = false;

  static async #getTxnInfoFromBlockfrost(txHash, resource, lucid) {
    return fetch(`${lucid.provider.url}/txs/${txHash}/${resource}`, {
      headers: { project_id: lucid.provider.projectId },
    }).then(res => res.json());
  }

  static async getInputUtxo(metadata, payees, lucid) {
    const txHash = metadata.txHash;
    const inputTxn = await JpgStore.#getTxnInfoFromBlockfrost(txHash, 'utxos', lucid);
    const relevantOutput = JpgStore.#findRelevantOutput(inputTxn, metadata.assetId);

    const txnMetadata = await JpgStore.#getTxnInfoFromBlockfrost(txHash, 'metadata', lucid);
    const datum = fromHex(txnMetadata.map(elem => elem.json_metadata).join(''));
    const datumHash = datumToHash(datum);
    validate(relevantOutput.data_hash === datumHash, `Expected ${datumHash}, found ${relevantOutput.data_hash}`);

    return {
      txHash: inputTxn.hash,
      outputIndex: relevantOutput.output_index,
      assets: (() => {
        const a = {};
        relevantOutput.amount.forEach((am) => {
          a[am.unit] = BigInt(am.quantity);
        });
        return a;
      })(),
      address: relevantOutput.address,
      datumHash: datumHash,
      datum: datum
    }
  }

  static #findRelevantOutput(inputTxn, assetId) {
    for (const output of inputTxn.outputs) {
      for (const amount of output.amount) {
        if (amount.unit === assetId) {
          return output
        }
      }
    }
  }

  static constructDatumFor(payees, lucid) {
    var payeeSchemas = [];
    if (payees.royalty !== undefined) {
      const royaltyDetails = lucid.utils.getAddressDetails(payees.royalty.addr);
      payeeSchemas.push(
        JpgStore.#paymentSchema(
          royaltyDetails.paymentCredential.hash,
          royaltyDetails.stakeCredential.hash,
          JpgStore.#normalizedTokenPolicy(payees.royalty.token),
          JpgStore.#normalizedTokenName(payees.royalty.token),
          JpgStore.IGNORE_CURRENCY_NAME,
          payees.royalty.amount
        )
      );
    }

    const marketFeeDetails = lucid.utils.getAddressDetails(payees.market_fee.addr);
    payeeSchemas.push(
      JpgStore.#paymentSchema(
        marketFeeDetails.paymentCredential.hash,
        marketFeeDetails.stakeCredential.hash,
        JpgStore.#normalizedTokenPolicy(payees.market_fee.token),
        JpgStore.#normalizedTokenName(payees.market_fee.token),
        JpgStore.IGNORE_CURRENCY_NAME,
        payees.market_fee.amount
      )
    );

    const sellerDetails = lucid.utils.getAddressDetails(payees.seller.addr);
    payeeSchemas.push(
      JpgStore.#paymentSchema(
        sellerDetails.paymentCredential.hash,
        sellerDetails.stakeCredential.hash,
        JpgStore.#normalizedTokenPolicy(payees.seller.token),
        JpgStore.#normalizedTokenName(payees.seller.token),
        JpgStore.IGNORE_CURRENCY_NAME,
        payees.seller.amount
      )
    );

    const data = Data.to(
      new Construct(
        0,
        [sellerDetails.paymentCredential.hash, payeeSchemas]
      )
    );
    return fromHex(data);
  }

  static #normalizedTokenPolicy(currency) {
    if (currency === 'lovelace') {
      return '';
    }
    return currency.slice(0, 56);
  }

  static #normalizedTokenName(currency) {
    if (currency === 'lovelace') {
      return '';
    }
    return currency.slice(56);
  }

  static #paymentSchema(paymentAddr, stakeKey, currencyPolicy, currencyName, lookAtCurrencyName, amount) {
    return new Construct(0, [
      new Construct(0, [
        new Construct(0, [
          paymentAddr
        ]),
        new Construct(0, [
          new Construct(0, [
            new Construct(0, [
              stakeKey
            ]),
          ]),
        ]),
      ]),
      new Map([[
        currencyPolicy,
        new Construct(0, [
          lookAtCurrencyName ? 1 : 0,
          new Map([[currencyName, amount]])
        ])
      ]])
    ])
  }

  static getRedeemer(metadata, payees, lucid) {
    return Data.to(new Construct(1, []));
  }

}
