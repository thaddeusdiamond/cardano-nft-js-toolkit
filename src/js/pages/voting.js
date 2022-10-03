import * as helios from '@hyperionbt/helios';

import * as CardanoDAppJs from '../third-party/cardano-dapp-js.js';
import * as LucidInst from '../third-party/lucid-inst.js';

import {Data, toHex} from 'lucid-cardano';

import {shortToast} from '../third-party/toastify-utils.js';
import {validate, validated} from '../nft-toolkit/utils.js';

const SINGLE_NFT = 1n;
const POLLS_OPEN = 1664462000000;
const POLLS_CLOSE = 1666242000000; // 10/20/22 00:00:00
const REFERENCE_POLICY_ID = '56fd93ef8ebe4c73645acadaf477716ce97339050244644cef325741';
const TEN_MINS = 600000;

function getBallotSourceCodeStr(referencePolicyId, pollsClose) {
  return `
    minting voting_ballot

    const POLLS_CLOSE: Time = Time::new(${pollsClose})
    const REFERENCE_POLICY_HASH: MintingPolicyHash = MintingPolicyHash::new(#${referencePolicyId})
    const SINGLE_NFT: Int = 1

    enum Redeemer {
      Mint
    }

    func tx_outputs_contain(voting_asset: AssetClass, outputs: []TxOutput) -> Bool {
      outputs.any((tx_out: TxOutput) -> Bool {
        print("Searching...");
        print(voting_asset.serialize().show());
        print(tx_out.value.serialize().show());
        tx_out.value.contains(Value::new(voting_asset, SINGLE_NFT))
      })
    }

    func assets_were_spent(minted_assets: Value, policy: MintingPolicyHash, outputs: []TxOutput) -> Bool {
      tx_sends_to_self: Bool = minted_assets.get_policy(policy).all((asset_id: ByteArray, amount: Int) -> Bool {
        voting_asset: AssetClass = AssetClass::new(REFERENCE_POLICY_HASH, asset_id);
        tx_outputs_contain(voting_asset, outputs) && amount == SINGLE_NFT
      });
      if (tx_sends_to_self) {
        true
      } else {
        print("The NFTs with voting power for the ballots were never sent-to-self");
        false
      }
    }

    func polls_are_still_open(time_range: TimeRange) -> Bool {
      tx_during_polls_open: Bool = time_range.is_before(POLLS_CLOSE);
      if (tx_during_polls_open) {
        true
      } else {
        print("Invalid time range: " + time_range.serialize().show() + " (polls close at " + POLLS_CLOSE.serialize().show() + ")");
        false
      }
    }

    func main(redeemer: Redeemer, ctx: ScriptContext) -> Bool {
      redeemer.switch {
        Mint =>  {
          tx: Tx = ctx.tx;
          minted_policy: MintingPolicyHash = ctx.get_current_minting_policy_hash();

          polls_are_still_open(tx.time_range) && assets_were_spent(tx.minted, minted_policy, tx.outputs)
        }
      }
    }
  `;
}

function getCompiledCode(mintingSourceCode) {
  return helios.Program.new(mintingSourceCode).compile();
}

function getLucidScript(compiledCode) {
  return {
    type: "PlutusV2",
    script: JSON.parse(compiledCode.serialize()).cborHex
  }
}

export async function mintBallot(blockfrostKey, policyID) {
  try {
    const heliosSourceCode = getBallotSourceCodeStr(REFERENCE_POLICY_ID, POLLS_CLOSE);
    const heliosCompiledCode = getCompiledCode(heliosSourceCode);
    const heliosMintingPolicy = getLucidScript(heliosCompiledCode);

    const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before sweeping using "Connect Wallet" button');
    const wallet = await cardanoDApp.getConnectedWallet();

    const lucid = validated(await LucidInst.getLucidInstance(blockfrostKey), 'Please validate that your wallet is on the correct network');
    lucid.selectWallet(wallet);
    const voter = await lucid.wallet.address();

    // TODO: Get name from the user
    const assetName = toHex(new TextEncoder().encode('WildTangz 2'));

    const assetId = `${heliosCompiledCode.mintingPolicyHash.hex}${assetName}`;
    const mintAssets = { [assetId]: SINGLE_NFT };
    const vendAssets = { lovelace: 2n, [assetId]: SINGLE_NFT };
    const referenceAssets = { [`${REFERENCE_POLICY_ID}${assetName}`]: 1 };
    const txBuilder = lucid.newTx()
                           .addSigner(voter)
                           .mintAssets(mintAssets, Data.empty())
                           .attachMintingPolicy(heliosMintingPolicy)
                           .payToAddress(voter, vendAssets)
                           .payToAddress(voter, referenceAssets)
                           .validTo(new Date().getTime() + TEN_MINS);

    const txComplete = await txBuilder.complete({ nativeUplc: false });
    const txSigned = await txComplete.sign().complete();
    const txHash = await txSigned.submit();
    shortToast(`Successfully submitted ${txHash}`);
  } catch (err) {
    shortToast(JSON.stringify(err));
  }
}
