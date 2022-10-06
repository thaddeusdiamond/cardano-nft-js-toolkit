import * as helios from '@hyperionbt/helios';

import * as CardanoDAppJs from '../third-party/cardano-dapp-js.js';
import * as LucidInst from '../third-party/lucid-inst.js';

import {Data, toHex} from 'lucid-cardano';

import {shortToast} from '../third-party/toastify-utils.js';
import {validate, validated} from '../nft-toolkit/utils.js';

const SINGLE_NFT = 1n;
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
        //print("Searching...");
        //print(voting_asset.serialize().show());
        //print(tx_out.value.serialize().show());
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

export async function mintBallot(blockfrostKey, policyId, pollsClose) {
  try {
    const heliosSourceCode = getBallotSourceCodeStr(policyId, pollsClose);
    const heliosCompiledCode = getCompiledCode(heliosSourceCode);
    const heliosMintingPolicy = getLucidScript(heliosCompiledCode);

    const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before voting using "Connect Wallet" button');
    const wallet = await cardanoDApp.getConnectedWallet();

    const lucid = validated(await LucidInst.getLucidInstance(blockfrostKey), 'Please validate that your wallet is on the correct network');
    lucid.selectWallet(wallet);
    const voter = await lucid.wallet.address();

    var mintAssets = {};
    var referenceAssets = {};
    const mintingPolicyId = heliosCompiledCode.mintingPolicyHash.hex;
    const assetIds = await getVotingAssets([policyId], [], lucid);
    for (const assetId in assetIds.assets) {
      const assetName = assetId.slice(56);
      mintAssets[`${mintingPolicyId}${assetName}`] = SINGLE_NFT;
      referenceAssets[`${policyId}${assetName}`] = SINGLE_NFT;
    }
    const txBuilder = lucid.newTx()
                           .addSigner(voter)
                           .mintAssets(mintAssets, Data.empty())
                           .attachMintingPolicy(heliosMintingPolicy)
                           .payToAddress(voter, mintAssets)
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

async function getVotingAssets(votingPolicies, exclusions, lucid) {
  if (votingPolicies === undefined || votingPolicies === []) {
    return {};
  }
  const votingAssets = {};
  const utxos = [];
  for (const utxo of await lucid.wallet.getUtxos()) {
    var found = false;
    for (const assetName in utxo.assets) {
      if (!votingPolicies.includes(assetName.slice(0, 56))) {
        continue;
      }
      if (exclusions.includes(assetName)) {
        continue;
      }
      if (votingAssets[assetName] === undefined) {
        votingAssets[assetName] = 0n;
      }
      votingAssets[assetName] += utxo.assets[assetName];
      found = true;
    }
    if (found) {
      utxos.push(utxo);
    }
  }
  return { assets: votingAssets, utxos: utxos };
}

async function walletVotingAssets(blockfrostKey, votingPolicies, exclusions) {
  var cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
  if (!cardanoDApp.isWalletConnected()) {
    return {};
  }

  try {
    const wallet = await cardanoDApp.getConnectedWallet();
    const lucidInst = validated(LucidInst.getLucidInstance(blockfrostKey), 'Unable to initialize Lucid, network mismatch detected');

    const lucid = validated(await lucidInst, 'Unable to initialize Lucid, network mismatch detected');
    lucid.selectWallet(wallet);
    return await getVotingAssets(votingPolicies, exclusions, lucid);
  } catch (err) {
    const msg = (typeof(err) === 'string') ? err : JSON.stringify(err);
    shortToast(`Voting power retrieval error occurred: ${msg}`);
    return {};
  }
}

export async function votingAssetsAvailable(blockfrostKey, votingPolicies, exclusions) {
  const votingAssets = await walletVotingAssets(blockfrostKey, votingPolicies, exclusions);
  if (votingAssets.assets) {
    const remainingVotingBigInt =
      Object.values(votingAssets.assets)
            .reduce((partialSum, a) => partialSum + a, 0n);
    return Number(remainingVotingBigInt);
  }
  return -1;
}
