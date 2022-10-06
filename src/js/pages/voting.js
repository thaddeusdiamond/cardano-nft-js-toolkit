import * as helios from '@hyperionbt/helios';

import * as CardanoDAppJs from '../third-party/cardano-dapp-js.js';
import * as LucidInst from '../third-party/lucid-inst.js';

import {Data, toHex} from 'lucid-cardano';

import {shortToast} from '../third-party/toastify-utils.js';
import {validate, validated} from '../nft-toolkit/utils.js';

const SINGLE_NFT = 1n;
const TEN_MINS = 600000;

function getVoteCounterSourceCode(pubKeyHash) {
  return `
    spending vote_counter

    const EXPECTED_SIGNER: PubKeyHash = PubKeyHash::new(#${pubKeyHash})

    func signed_by_expected(signatories: []PubKeyHash) -> Bool {
      signatories.any((signatory: PubKeyHash) -> Bool {
        signatory == EXPECTED_SIGNER
      })
    }

    func main(ctx: ScriptContext) -> Bool {
      print(ctx.tx.signatories.serialize().show());
      signed_by_expected(ctx.tx.signatories)
    }
  `;
}

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

function getBallotSelection(ballotDomName) {
  return document.querySelector(`input[name=${ballotDomName}]:checked`).value;
}


export async function mintBallot(blockfrostKey, pubKeyHash, policyId, pollsClose, ballotDomName) {
  try {
    const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before voting using "Connect Wallet" button');
    const wallet = await cardanoDApp.getConnectedWallet();

    const lucid = validated(await LucidInst.getLucidInstance(blockfrostKey), 'Please validate that your wallet is on the correct network');
    lucid.selectWallet(wallet);
    const voter = await lucid.wallet.address();

    const voteCounterSourceCode = getVoteCounterSourceCode(pubKeyHash);
    const voteCounterCompiledCode = getCompiledCode(voteCounterSourceCode);
    const voteCounterScript = getLucidScript(voteCounterCompiledCode)
    const voteCounter = lucid.utils.validatorToAddress(voteCounterScript);

    const mintingSourceCode = getBallotSourceCodeStr(policyId, pollsClose);
    const mintingCompiledCode = getCompiledCode(mintingSourceCode);
    const voteMintingPolicy = getLucidScript(mintingCompiledCode);

    var mintAssets = {};
    var referenceAssets = {};
    const mintingPolicyId = mintingCompiledCode.mintingPolicyHash.hex;
    const assetIds = await getVotingAssets([policyId], [], lucid);
    for (const assetId in assetIds.assets) {
      const assetName = assetId.slice(56);
      mintAssets[`${mintingPolicyId}${assetName}`] = SINGLE_NFT;
      referenceAssets[`${policyId}${assetName}`] = SINGLE_NFT;
    }

    const vote = getBallotSelection(ballotDomName);
    const voteDatum = {
      inline: Data.to(Data.fromJson({ voter: voter, vote: vote }))
    };

    const txBuilder = lucid.newTx()
                           .addSigner(voter)
                           .mintAssets(mintAssets, Data.empty())
                           .attachMintingPolicy(voteMintingPolicy)
                           .payToContract(voteCounter, voteDatum, mintAssets)
                           .payToAddress(voter, referenceAssets)
                           .validTo(new Date().getTime() + TEN_MINS);

    const txComplete = await txBuilder.complete({ nativeUplc: false });
    const txSigned = await txComplete.sign().complete();
    const txHash = await txSigned.submit();
    shortToast(`Successfully voted in Tx ${txHash}`);
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

export async function redeemBallots(blockfrostKey, pubKeyHash, policyId, pollsClose, voteOutputDom) {
  try {
    const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before voting using "Connect Wallet" button');
    const wallet = await cardanoDApp.getConnectedWallet();

    const lucid = validated(await LucidInst.getLucidInstance(blockfrostKey), 'Please validate that your wallet is on the correct network');
    lucid.selectWallet(wallet);
    const voter = await lucid.wallet.address();

    const voteCounterSourceCode = getVoteCounterSourceCode(pubKeyHash);
    const voteCounterCompiledCode = getCompiledCode(voteCounterSourceCode);
    const voteCounterScript = getLucidScript(voteCounterCompiledCode)
    const voteCounter = lucid.utils.validatorToAddress(voteCounterScript);

    const mintingSourceCode = getBallotSourceCodeStr(policyId, pollsClose);
    const mintingCompiledCode = getCompiledCode(mintingSourceCode);
    const mintingPolicyId = mintingCompiledCode.mintingPolicyHash.hex;

    var votesToCollect = [];
    var voteAssets = {};
    var voteResults = {};
    const votes = await lucid.utxosAt(voteCounter);
    for (const vote of votes) {
      votesToCollect.push(vote);
      var totalVotingPower = 0;
      for (const unit in vote.assets) {
        const quantity = Number(vote.assets[unit]);
        if (!(unit in voteAssets)) {
          voteAssets[unit] = 0;
        }
        if (unit.startsWith(mintingPolicyId)) {
          totalVotingPower += quantity;
        }
        voteAssets[unit] += quantity;
      }

      const voteResult = Data.toJson(Data.from(vote.datum));
      if (!(voteResult.vote in voteResults)) {
        voteResults[voteResult.vote] = [];
      }
      voteResults[voteResult.vote].push({ [voteResult.voter]: totalVotingPower });
    }

    document.getElementById(voteOutputDom).innerHTML = JSON.stringify(voteResults);

    const txBuilder = lucid.newTx()
                           .addSigner(voter)
                           .collectFrom(votesToCollect, Data.empty())
                           .attachSpendingValidator(voteCounterScript)
                           .payToAddress(voter, voteAssets);
    const txComplete = await txBuilder.complete({ nativeUplc: false });
    const txSigned = await txComplete.sign().complete();
    const txHash = await txSigned.submit();
    shortToast(`Successfully counted ballots in ${txHash}`);
  } catch (err) {
    shortToast(JSON.stringify(err));
  }
}
