import * as helios from '@hyperionbt/helios';

import * as CardanoDAppJs from '../third-party/cardano-dapp-js.js';
import * as LucidInst from '../third-party/lucid-inst.js';
import * as NftPolicy from "../nft-toolkit/nft-policy.js";

import {RebateCalculator} from "../nft-toolkit/rebate-calculator.js";

import {Data, fromHex, toHex, getAddressDetails} from 'lucid-cardano';

import {shortToast} from '../third-party/toastify-utils.js';
import {validate, validated} from '../nft-toolkit/utils.js';

const BURN_REDEEMER = 'd87a80';
const LOVELACE = 'lovelace';
const MAX_NFTS_TO_MINT = 20;
const MAX_UTXOS_TO_REDEEM = 50;
const MAX_ATTEMPTS = 12;
const OPTIMIZE_HELIOS = true;
const SINGLE_NFT = 1n;
const TEN_MINS = 600000;
const TXN_WAIT_TIMEOUT = 15000;

function getVoteCounterSourceCode(pubKeyHash) {
  return `
    spending vote_counter

    const EXPECTED_SIGNER: PubKeyHash = PubKeyHash::new(#${pubKeyHash})

    func main(ctx: ScriptContext) -> Bool {
      ctx.tx.is_signed_by(EXPECTED_SIGNER)
    }
  `;
}

function getBallotSourceCodeStr(referencePolicyId, pollsClose, pubKeyHash, ballotPrefix) {
  return `
    minting voting_ballot

    const BALLOT_BOX_PUBKEY: ValidatorHash = ValidatorHash::new(#${pubKeyHash})
    const BALLOT_NAME_PREFIX: ByteArray = #${ballotPrefix}
    const POLLS_CLOSE: Time = Time::new(${pollsClose})
    const REFERENCE_POLICY_HASH: MintingPolicyHash = MintingPolicyHash::new(#${referencePolicyId})

    enum Redeemer {
      Mint
      Burn
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

    func assets_were_spent(minted: Value, policy: MintingPolicyHash, outputs: []TxOutput) -> Bool {
      minted_assets: Map[ByteArray]Int = minted.get_policy(policy);
      reference_assets_names: Map[ByteArray]Int = minted_assets.map_keys((asset_id: ByteArray) -> ByteArray {
        asset_id.slice(BALLOT_NAME_PREFIX.length, asset_id.length)
      });
      reference_assets: Map[MintingPolicyHash]Map[ByteArray]Int = Map[MintingPolicyHash]Map[ByteArray]Int {
        REFERENCE_POLICY_HASH: reference_assets_names
      };
      tx_sends_to_self: Bool = outputs.head.value.contains(Value::from_map(reference_assets));
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
      tx: Tx = ctx.tx;
      minted_policy: MintingPolicyHash = ctx.get_current_minting_policy_hash();
      redeemer.switch {
        Mint => {
          polls_are_still_open(tx.time_range)
            && assets_were_spent(tx.minted, minted_policy, tx.outputs)
            && assets_locked_in_script(tx, tx.minted)
        },
        Burn => {
          tx.minted.get_policy(minted_policy).all((asset_id: ByteArray, amount: Int) -> Bool {
            if (amount > 0) {
              print(asset_id.show() + " asset ID was minted not burned (quantity " + amount.show() + ")");
              false
            } else {
              true
            }
          })
        }
      }
    }
  `;
}

function getCompiledCode(mintingSourceCode) {
  return helios.Program.new(mintingSourceCode).compile(OPTIMIZE_HELIOS);
}

function getLucidScript(compiledCode) {
  return {
    type: "PlutusV2",
    script: JSON.parse(compiledCode.serialize()).cborHex
  }
}

async function waitForTxn(lucid, blockfrostKey, txHash) {
  for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await fetch(`${lucid.provider.data.url}/txs/${txHash}`, {
      headers: { project_id: blockfrostKey }
    }).then(res => res.json());
    if (result && !result.error) {
      return;
    }

    if (attempt < (MAX_ATTEMPTS - 1)) {
      await new Promise(resolve => setTimeout(resolve, TXN_WAIT_TIMEOUT));
    }
  }
  throw `Could not retrieve voting txn after ${MAX_ATTEMPTS} attempts`;
}

function calculateCurrentVote(currVoteNum, vote) {
  var remaining = currVoteNum;
  for (const voteOption of Object.keys(vote).sort()) {
    const votesToCast = vote[voteOption];
    if (remaining <= votesToCast) {
      return voteOption;
    }
    remaining -= votesToCast;
  }
  throw 'Illegal internal vote state';
}

export async function mintBallot(blockfrostKey, pubKeyHash, policyId, pollsClose, ballotPrefix, ballotMetadata, vote) {
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

    const ballotPrefixHex = toHex(new TextEncoder().encode(ballotPrefix));
    const mintingSourceCode = getBallotSourceCodeStr(policyId, pollsClose, voteCounterPkh, ballotPrefixHex);
    const mintingCompiledCode = getCompiledCode(mintingSourceCode);
    const voteMintingPolicy = getLucidScript(mintingCompiledCode);
    const voteMintingPolicyId = mintingCompiledCode.mintingPolicyHash.hex;

    const votingAssets = await getVotingAssets([policyId], [], lucid);
    const assetIds = Object.keys(votingAssets.assets);
    var assetIdsChunked = [];
    for (var i = 0; i < assetIds.length; i += MAX_NFTS_TO_MINT) {
      assetIdsChunked.push(assetIds.slice(i, i + MAX_NFTS_TO_MINT));
    }
    if (assetIdsChunked.length > 1) {
      validate(
        confirm(`We will have to split your votes into ${assetIdsChunked.length} different transactions due to blockchain size limits, should we proceed?`),
        "Did not agree to submit multiple voting transactions"
      );
    }

    var currVoteNum = 1;
    for (var i = 0; i < assetIdsChunked.length; i++) {
      var mintAssets = {};
      var lockedAssets = {};
      var referenceAssets = {};
      var ballotNameChars = 0;
      var mintingMetadata = { [voteMintingPolicyId]: {}, version: NftPolicy.CIP0025_VERSION }
      for (const assetId of assetIdsChunked[i]) {
        var currVote = calculateCurrentVote(currVoteNum, vote);
        if (!(currVote in lockedAssets)) {
          lockedAssets[currVote] = {}
        }

        const assetName = assetId.slice(56);
        const ballotNameHex = `${ballotPrefixHex}${assetName}`;
        const ballotName = new TextDecoder().decode(fromHex(ballotNameHex));
        const ballotId = `${voteMintingPolicyId}${ballotNameHex}`;
        mintAssets[ballotId] = SINGLE_NFT;
        lockedAssets[currVote][ballotId] = SINGLE_NFT;
        ballotNameChars += ballotName.length;
        referenceAssets[`${policyId}${assetName}`] = SINGLE_NFT;
        mintingMetadata[voteMintingPolicyId][ballotName] = Object.assign({}, ballotMetadata);
        mintingMetadata[voteMintingPolicyId][ballotName].name = ballotName;
        mintingMetadata[voteMintingPolicyId][ballotName].vote = currVote;
        currVoteNum++;
      }

      const txBuilder = lucid.newTx()
                             .addSigner(voter)
                             .mintAssets(mintAssets, Data.empty())
                             .attachMintingPolicy(voteMintingPolicy)
                             .attachMetadata(NftPolicy.METADATA_KEY, mintingMetadata)
                             .payToAddress(voter, referenceAssets)
                             .validTo(new Date().getTime() + TEN_MINS);

      for (const voteOption in vote) {
        if (!(voteOption in lockedAssets)) {
          continue;
        }
        const voteDatum = {
          inline: Data.to(Data.fromJson({ voter: voter, vote: voteOption }))
        };
        txBuilder.payToContract(voteCounter, voteDatum, lockedAssets[voteOption])
      }

      const txComplete = await txBuilder.complete({ nativeUplc: false });
      const txSigned = await txComplete.sign().complete();
      const txHash = await txSigned.submit();
      shortToast(`[${i + 1}/${assetIdsChunked.length}] Successfully voted in Tx ${txHash}`);
      if (i < (assetIdsChunked.length - 1)) {
        shortToast('Waiting for prior transaction to finish, please wait for pop-ups to complete your vote!');
        await waitForTxn(lucid, blockfrostKey, txHash);
      } else {
        shortToast('Your vote(s) have been successfully recorded!');
      }
    }
    return true;
  } catch (err) {
    shortToast(JSON.stringify(err));
  }
  return false;
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

export async function countBallots(blockfrostKey, pubKeyHash, policyId, pollsClose, voteOutputDom, ballotPrefix) {
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

    const ballotPrefixHex = toHex(new TextEncoder().encode(ballotPrefix));
    const mintingSourceCode = getBallotSourceCodeStr(policyId, pollsClose, voteCounterPkh, ballotPrefixHex);
    const mintingCompiledCode = getCompiledCode(mintingSourceCode);
    const mintingPolicyId = mintingCompiledCode.mintingPolicyHash.hex;

    var voteAssets = {};
    const votes = await lucid.utxosAt(voteCounter);
    for (const vote of votes) {
      if (!vote.datum) {
        continue;
      }
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
      }
    }

    var csvOutput = 'unit,voter,vote,count\n';
    for (const unit in voteAssets) {
      const voteInfo = voteAssets[unit];
      csvOutput += `${unit},${voteInfo.voter},${voteInfo.vote},${voteInfo.count}\n`;
    }

    document.getElementById(voteOutputDom).innerHTML = `<pre style="text-align: start">${csvOutput}</pre>`;
    return csvOutput;
  } catch (err) {
    shortToast(JSON.stringify(err));
  }
}

export async function redeemBallots(blockfrostKey, pubKeyHash, policyId, pollsClose, voteOutputDom, ballotPrefix) {
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

    const ballotPrefixHex = toHex(new TextEncoder().encode(ballotPrefix));
    const mintingSourceCode = getBallotSourceCodeStr(policyId, pollsClose, voteCounterPkh, ballotPrefixHex);
    const mintingCompiledCode = getCompiledCode(mintingSourceCode);
    const mintingPolicyId = mintingCompiledCode.mintingPolicyHash.hex;

    const votes = await lucid.utxosAt(voteCounter);
    const votesChunked = [];
    for (var i = 0; i < votes.length; i += MAX_UTXOS_TO_REDEEM) {
      votesChunked.push(votes.slice(i, i + MAX_UTXOS_TO_REDEEM));
    }
    for (const votesChunk of votesChunked) {
      var voterRepayments = {};
      var votesToCollect = [];
      for (const vote of votesChunk) {
        if (!vote.datum) {
          continue;
        }
        const voteResult = Data.toJson(Data.from(vote.datum));
        var hasVote = false;
        for (const unit in vote.assets) {
          if (!unit.startsWith(mintingPolicyId)) {
            continue;
          }
          hasVote = true;
          const voteCount = Number(vote.assets[unit]);
          if (!(voteResult.voter in voterRepayments)) {
            voterRepayments[voteResult.voter] = {}
          }
          if (!(unit in voterRepayments[voteResult.voter])) {
            voterRepayments[voteResult.voter][unit] = 0;
          }
          voterRepayments[voteResult.voter][unit] += voteCount;
        }

        if (hasVote) {
          votesToCollect.push(vote);
        }
      }

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
    }
  } catch (err) {
    shortToast(JSON.stringify(err));
  }
}

export async function burnExtraBallots(blockfrostKey, pubKeyHash, policyId, pollsClose, ballotPrefix) {
  try {
    const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before burning extra votes using "Connect Wallet" button');
    const wallet = await cardanoDApp.getConnectedWallet();

    const lucid = validated(await LucidInst.getLucidInstance(blockfrostKey), 'Please validate that your wallet is on the correct network');
    lucid.selectWallet(wallet);
    const voter = await lucid.wallet.address();

    const voteCounterSourceCode = getVoteCounterSourceCode(pubKeyHash);
    const voteCounterCompiledCode = getCompiledCode(voteCounterSourceCode);
    const voteCounterScript = getLucidScript(voteCounterCompiledCode)
    const voteCounter = lucid.utils.validatorToAddress(voteCounterScript);
    const voteCounterPkh = getAddressDetails(voteCounter).paymentCredential.hash;

    const ballotPrefixHex = toHex(new TextEncoder().encode(ballotPrefix));
    const mintingSourceCode = getBallotSourceCodeStr(policyId, pollsClose, voteCounterPkh, ballotPrefixHex);
    const mintingCompiledCode = getCompiledCode(mintingSourceCode);
    const mintingPolicy = getLucidScript(mintingCompiledCode);
    const mintingPolicyId = mintingCompiledCode.mintingPolicyHash.hex;

    const utxos = await lucid.wallet.getUtxos();
    const utxosToCollect = [];
    const burnAssets = {};
    var hasAlerted = false;
    for (const utxo of utxos) {
      var foundAsset = false;
      for (const unit in utxo.assets) {
        if (unit.startsWith(mintingPolicyId)) {
          if (Object.keys(burnAssets).length >= MAX_NFTS_TO_MINT) {
            if (!hasAlerted) {
              alert(`Can only burn ${MAX_NFTS_TO_MINT} ballots to burn at a time.  Start with that, then click this button again.`);
              hasAlerted = true;
            }
            break;
          }
          foundAsset = true;
          if (!(unit in burnAssets)) {
            burnAssets[unit] = 1n;
          }
          burnAssets[unit] -= utxo.assets[unit];
        }
      }

      if (foundAsset) {
        utxosToCollect.push(utxo);
      }
    }

    var hasExtras = false;
    for (const ballot in burnAssets) {
      if (burnAssets[ballot] < 0n) {
        hasExtras = true;
        break;
      }
    }
    if (!hasExtras) {
      shortToast(`Could not find any extra ballots of policy '${mintingPolicyId}' in your wallet!`);
      return false;
    }

    const txBuilder = lucid.newTx()
                           .addSigner(voter)
                           .collectFrom(utxosToCollect)
                           .mintAssets(burnAssets, BURN_REDEEMER)
                           .attachMintingPolicy(mintingPolicy)
                           .validTo(new Date().getTime() + TEN_MINS);
    const txComplete = await txBuilder.complete({ nativeUplc: false });
    const txSigned = await txComplete.sign().complete();
    const txHash = await txSigned.submit();
    shortToast(`Successfully burned your ballots in ${txHash}`);
    return true;
  } catch (err) {
    shortToast(JSON.stringify(err));
    return false;
  }
}

export async function splitUpVotingAssets(blockfrostKey, policyId) {
  try {
    validate(
      confirm('Nami sometimes has an error with large wallets that results in an error message about minADA.  We can attempt to send all Tangz to yourself (not leaving your wallet) to see if this fixes it.  Should we proceed?'),
      'Did not agree to send-to-self in Nami'
    );

    const cardanoDApp = CardanoDAppJs.getCardanoDAppInstance();
    validate(cardanoDApp.isWalletConnected(), 'Please connect a wallet before attempting a send-to-self using "Connect Wallet" button');
    const wallet = await cardanoDApp.getConnectedWallet();

    const lucid = validated(await LucidInst.getLucidInstance(blockfrostKey), 'Please validate that your wallet is on the correct network');
    lucid.selectWallet(wallet);
    const voter = await lucid.wallet.address();

    const votingAssets = await getVotingAssets([policyId], [], lucid);
    const assetIds = Object.keys(votingAssets.assets);
    var assetIdsChunked = [];
    for (var i = 0; i < assetIds.length; i += MAX_NFTS_TO_MINT) {
      assetIdsChunked.push(assetIds.slice(i, i + MAX_NFTS_TO_MINT));
    }
    if (assetIdsChunked.length > 1) {
      validate(
        confirm(`We will have to do multiple send-to-self transactions, should we proceed??`),
        "Did not agree to submit multiple send-to-self transactions"
      );
    }

    for (var i = 0; i < assetIdsChunked.length; i++) {
      var referenceAssets = {};
      for (const assetId of assetIdsChunked[i]) {
        referenceAssets[assetId] = SINGLE_NFT;
      }
      referenceAssets[LOVELACE] = RebateCalculator.calculateRebate(1, assetIdsChunked[i].length, ballotNameChars);

      const txBuilder = lucid.newTx()
                             .addSigner(voter)
                             .payToAddress(voter, referenceAssets)
                             .validTo(new Date().getTime() + TEN_MINS);

      const txComplete = await txBuilder.complete();
      const txSigned = await txComplete.sign().complete();
      const txHash = await txSigned.submit();
      shortToast(`[${i + 1}/${assetIdsChunked.length}] Successfully sent-to-self in Tx ${txHash}`);
      if (i < (assetIdsChunked.length - 1)) {
        shortToast('Waiting for prior transaction to finish, please wait for pop-ups to complete your vote!');
        await waitForTxn(lucid, blockfrostKey, txHash);
      } else {
        shortToast('Your Nami send-to-self transactions completed!');
      }
    }
  } catch (err) {
    shortToast(JSON.stringify(err));
  }
}
