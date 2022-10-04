import {Constr, Data, Utils} from "lucid-cardano";

const MarketType = {
  EPOCHART: 'epochart_schema',
  JPGSTORE: 'jpgstore_schema',
}

function epochArtSchema(id, payees) {
  const seller = payees[0];
  const epoch = payees[1];

  var price = seller.amount + epoch.amount;
  var royalty = undefined;
  if (payees.length > 2) {
    royalty = payees[2];
    price += royalty.amount
  }

  var payments = [
    seller.pubKeyHash,
    price,
    id.slice(0, 56),
    id.slice(56)
  ]
  if (royalty !== undefined) {
    const royaltyAddressDetails = new Utils().getAddressDetails(royalty.addr);
    payments.push(royaltyAddressDetails.paymentCredential.hash);
    payments.push(royalty.datum);
  }

  return Data.to(new Construct(0, payments));
}

export function datumFor(utxo, id, payees) {
  switch (utxo.datumSchema) {
    case MarketType.EPOCHART:
      return epochArtSchema(id, payees);
    case MarketType.JPGSTORE:
      return utxo.datum;
    default:
      throw `Unexpected datum schema ${utxo.datumSchema} encountered for ${id}`;
  }
}
