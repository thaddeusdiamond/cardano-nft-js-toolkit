import {Construct, Data, Utils} from "lucid-cardano";

const MarketType = {
  EPOCHART: 'epochart_schema',
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

export function datumFor(datumSchema, id, payees) {
  switch (datumSchema) {
    case MarketType.EPOCHART:
      return epochArtSchema(id, payees);
    default:
      throw `Unexpected datum schema ${datumSchema} encountered for ${id}`;
  }
}
