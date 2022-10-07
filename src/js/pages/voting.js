import * as helios from '@hyperionbt/helios';

import * as CardanoDAppJs from '../third-party/cardano-dapp-js.js';
import * as LucidInst from '../third-party/lucid-inst.js';

import {Data, toHex, getAddressDetails} from 'lucid-cardano';

import {shortToast} from '../third-party/toastify-utils.js';
import {validate, validated} from '../nft-toolkit/utils.js';

const BURN_REDEEMER = 'd87a80';
const SINGLE_NFT = 1n;
const TEN_MINS = 600000;

function getVoteCounterSourceCode(pubKeyHash) {
  return `
    spending vote_counter

    const EXPECTED_SIGNER: PubKeyHash = PubKeyHash::new(#${pubKeyHash})

    func main(ctx: ScriptContext) -> Bool {
      ctx.tx.is_signed_by(EXPECTED_SIGNER)
    }
  `;
}

function getBallotSourceCodeStr(referencePolicyId, pollsClose, pubKeyHash) {
  return `
    minting voting_ballot

    const BALLOT_BOX_PUBKEY: ValidatorHash = ValidatorHash::new(#${pubKeyHash})
    const POLLS_CLOSE: Time = Time::new(${pollsClose})
    const REFERENCE_POLICY_HASH: MintingPolicyHash = MintingPolicyHash::new(#${referencePolicyId})
    const SINGLE_NFT: Int = 1

    enum Redeemer {
      Mint
    }

    func assets_locked_in_script(tx: Tx, minted_assets: Value) -> Bool {
      //print(tx.value_sent_to(BALLOT_BOX_PUBKEY).serialize().show());
      //print(minted_assets.serialize().show());
      ballots_sent: Value = tx.value_locked_by(BALLOT_BOX_PUBKEY);
      assets_locked: Bool = ballots_sent.contains(minted_assets);
      if (assets_locked) {
        true
      } else {
        print("Minted ballots (" + minted_assets.serialize().show() + ") were not correctly locked in the script: " + ballots_sent.serialize().show());
        false
      }
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
        print("The NFTs with voting power (" + REFERENCE_POLICY_HASH.serialize().show() + ") for the ballots were never sent-to-self");
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

          polls_are_still_open(tx.time_range)
            && assets_were_spent(tx.minted, minted_policy, tx.outputs)
            && assets_locked_in_script(tx, tx.minted)
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
    const voteCounterPkh = getAddressDetails(voteCounter).paymentCredential.hash;

    const mintingSourceCode = getBallotSourceCodeStr(policyId, pollsClose, voteCounterPkh);
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
    const oracle = await lucid.wallet.address();

    const voteCounterSourceCode = getVoteCounterSourceCode(pubKeyHash);
    const voteCounterCompiledCode = getCompiledCode(voteCounterSourceCode);
    const voteCounterScript = getLucidScript(voteCounterCompiledCode)
    const voteCounter = lucid.utils.validatorToAddress(voteCounterScript);
    const voteCounterPkh = getAddressDetails(voteCounter).paymentCredential.hash;

    const mintingSourceCode = getBallotSourceCodeStr(policyId, pollsClose, voteCounterPkh);
    const mintingCompiledCode = getCompiledCode(mintingSourceCode);
    const mintingPolicyId = mintingCompiledCode.mintingPolicyHash.hex;

    var voteAssets = {};
    const votes = await lucid.utxosAt(voteCounter);
    const votesToCollect = [];
    const voterRepayments = {};
    for (const vote of votes) {
      const voteResult = Data.toJson(Data.from(vote.datum));
      for (const unit in vote.assets) {
        if (!unit.startsWith(mintingPolicyId)) {
          continue;
        }
        const voteCount = Number(vote.assets[unit]);
        voteAssets[unit] = {
          voter: voteResult.voter,
          vote: voteResult.vote,
          count: voteCount
        }
        if (!(voteResult.voter in voterRepayments)) {
          voterRepayments[voteResult.voter] = {}
        }
        voterRepayments[voteResult.voter][unit] = voteCount;
      }

      votesToCollect.push(vote);
    }

    document.getElementById(voteOutputDom).innerHTML =
     `<pre style="text-align: start">${JSON.stringify(voteAssets, undefined, 4)}</pre>`;

    const txBuilder = lucid.newTx()
                           .addSigner(oracle)
                           .collectFrom(votesToCollect, Data.empty())
                           .attachSpendingValidator(voteCounterScript);
    for (const voter in voterRepayments) {
      txBuilder.payToAddress(voter, voterRepayments[voter]);
    }
    const txComplete = await txBuilder.complete({ nativeUplc: false });
    const txSigned = await txComplete.sign().complete();
    const txHash = await txSigned.submit();
    shortToast(`Successfully counted ballots in ${txHash}`);
  } catch (err) {
    shortToast(JSON.stringify(err));
  }
}
