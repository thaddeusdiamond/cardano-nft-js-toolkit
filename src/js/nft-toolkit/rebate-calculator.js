export class RebateCalculator {

  static COIN_SIZE = 0.0;             // Will change in next era to slightly lower fees
  static MIN_UTXO_VALUE = 1000000;
  static PIDSIZE = 28.0;
  static SINGLE_POLICY = 1;
  static UTXO_SIZE_WITHOUT_VAL = 27.0;

  static ADA_ONLY_UTXO_SIZE = RebateCalculator.COIN_SIZE + RebateCalculator.UTXO_SIZE_WITHOUT_VAL;
  static UTXO_BASE_RATIO = Math.ceil(RebateCalculator.MIN_UTXO_VALUE / RebateCalculator.ADA_ONLY_UTXO_SIZE);

  static calculateRebate(numPolicies, numAssets, totalNameChars) {
    if (!numAssets) {
      return 0n;
    }

    var assetWords = Math.ceil(((numAssets * 12.0) + (totalNameChars) + (numPolicies * RebateCalculator.PIDSIZE)) / 8.0);
    var utxoNativeTokenMultiplier = RebateCalculator.UTXO_SIZE_WITHOUT_VAL + (6 + assetWords);
    return BigInt(RebateCalculator.UTXO_BASE_RATIO * utxoNativeTokenMultiplier);
  }

  constructor() {
    throw 'This is a utility class, not to be instantiated';
  }

}
