import re
import tempfile

from io import BytesIO
from pycardano import hash, key, nativescript, transaction, witness

from chalicelib import holiday_imagegen

TANGZ_POLICY = '33568ad11f93b3e79ae8dee5ad928ded72adcea719e92108caf1521b'
TANGZ_SCRIPTHASH = hash.ScriptHash(bytes.fromhex(TANGZ_POLICY))

HOLIDAY_POLICY = '335695f7771bb789083b8a985308310ab8f0a4bbf8cd0687bbdb26b1'
HOLIDAY_SCRIPTHASH = hash.ScriptHash(bytes.fromhex(HOLIDAY_POLICY))
HOLIDAY_NATIVESCRIPT = nativescript.NativeScript.from_dict({
    "type": "all",
    "scripts": [
        {"type": "before", "slot": 82284197},
        {"type": "sig", "keyHash": "5eedc75541af273325ae50aac8febef57e38bf2dc1955b56714fa601"}
    ]
})

HOLIDAY_ASSETNAME = re.compile('^WildTangz H22 [0-9A-Z]+$')

METADATA_KEYS = ['name', 'project', 'mediaType', 'image']
BASE_TRAITS = ['body', 'fur', 'accessories', 'eyes', 'eyewear']
HOLIDAY_TRAITS = {
    'background': ['Candy', 'Chanukah', 'Gift Boxes', 'Kwanzaa', 'New Years Eve', 'Snow Things', 'Stockings'],
    'clothing': ['Chanukah Sweater', 'ChrismaHanuKwanzaa Sweater', 'Christmas Sweater Basic Green', 'Christmas Sweater Basic Red', 'Christmas Sweater Reindeer', 'Kwanzaa Sweater', 'Santa Sweater', 'Winter Sweater'],
    'headwear': ['Antler Ears', 'Elf Ears', 'Mistletoe', 'New Year Hat', 'Santa Cap', 'Yarmulke'],
    'mouth': ['Chanukah Cigar', 'Christmas Cigar', 'Kwanzaa Cigar', 'New Years Kazoo Blue', 'New Years Kazoo Purple', 'New Years Kazoo Red']
}
STATIC_METADATA = {
    'project': 'Wild Tangz - Holiday Mint 2022',
    'mediaType': 'image/png'
}

MINTER_ADDRESS = 'addr1qy4jk3wgy3ehcqmvv9e5jwdngaek8l3mry9r42ydvs6v3f9ncj7f00v3kcwxmjdvkuhdpwzscd372lp0hzrqvmjvpmjshwnjj2'
PAYMENT_LOVELACE = 25 * 1000000

def validated_txn(txn_hex, blockfrost, pics_dir, nft_storage_key):
    txn = transaction.Transaction.from_cbor(txn_hex)
    print(txn)

    # LOOK AT RIGHT TO DETERMINE VALIDATION OCCURRING ------------------------->
    asset_name = validated_holiday_mint(txn.transaction_body.mint)              # 1. Single asset minted following naming "WildTangz H22 {[0-9][A-Z]}+"
    metadata = validated_txn_metadata(txn.auxiliary_data.data, asset_name)      # 2. User is submitting only 721 (CIP-0025 metadata)

    allowed_keys = METADATA_KEYS + BASE_TRAITS + list(HOLIDAY_TRAITS.keys())
    only_keys_are_traits(metadata, allowed_keys)                                # 3. Only allowed traits are present
    mediatype_project_are_static(metadata)                                      # 4. Static metadata is correct

    outputs = txn.transaction_body.outputs
    validate_minter_is_paid(outputs, PAYMENT_LOVELACE)                          # 5. Minter is paid the expected price

    for base_tangz in find_send_to_self(outputs):                               # 6. User sent themselves Wild Tangz
        try:
            base_tangz_data = blockfrost.asset(base_tangz).onchain_metadata
            metadata_name_matches(metadata, base_tangz_data.name)               # 7. Metadata name matches "{base_tangz} - Holiday Mint 2022"
            holiday_changes_are_valid(
                base_tangz_data,
                metadata,
                BASE_TRAITS,
                HOLIDAY_TRAITS.keys(),
                HOLIDAY_TRAITS
            )                                                                   # 8. User changed at least one holiday item, rest match
            ipfs_image_matches_traits(metadata, pics_dir, nft_storage_key)      # 9. IPFS URL matches what we get from upload function
            return txn
        except Exception as e:
            print(f"Validation failed for {base_tangz}: {e}")
            continue

    raise ValueError("Could not validate the transaction provided by user")

def validated_holiday_mint(mint):
    if len(mint.keys()) != 1:
        raise ValueError(f"Minting multiple policies not allowed {mint}")
    if not HOLIDAY_SCRIPTHASH in mint:
        raise ValueError(f"Only allowed to mint holiday policy, found {mint}")
    asset_name_qty = mint[HOLIDAY_SCRIPTHASH]
    if len(asset_name_qty.keys()) != 1:
        raise ValueError(f"Expected to mint exactly 1 new NFT {mint}")
    asset_name = next(iter(asset_name_qty.keys())).payload.decode('utf-8')
    qty = next(iter(asset_name_qty.values()))
    if not HOLIDAY_ASSETNAME.match(asset_name):
        raise ValueError(f"Asset name not matching expected format {mint}")
    if qty != 1:
        raise ValueError(f"Expected to only mint quantity 1 of new asset {mint}")
    print(f"Validated mint: {mint}")
    return asset_name

def validated_txn_metadata(metadata, asset_name):
    if len(metadata.keys()) != 1:
        raise ValueError(f"Incorrect # of top-level keys found in {metadata}")
    if not 721 in metadata:
        raise ValueError(f"Did not find 721 top-level key in {metadata}")
    cip0025 = metadata[721]
    if len(cip0025.keys()) != 2:
        raise ValueError(f"Wrong # of policy/version keys found in {metadata}")
    if cip0025['version'] != '1.0':
        raise ValueError(f"Incorrect version found in {metadata}")
    if not HOLIDAY_POLICY in cip0025:
        raise ValueError(f"Cannot find holiday policy in {metadata}")
    if not asset_name in cip0025[HOLIDAY_POLICY]:
        raise ValueError(f"Cannot find {asset_name} in mint metadata {metadata}")
    print(f"Validated metadata: {metadata}")
    return cip0025[HOLIDAY_POLICY][asset_name]

def only_keys_are_traits(metadata, allowed_keys):
    if len(metadata.keys()) != len(allowed_keys):
        raise ValueError("Metadata has incorrect # of keys {metadata}")
    for allowed_key in allowed_keys:
        if not allowed_key in metadata:
            raise ValueError("Metadata missing key {allowed_key} {metadata}")
    print(f"Validated metadata keys: {metadata}")

def mediatype_project_are_static(metadata):
    for key, val in STATIC_METADATA.items():
        if metadata[key] != val:
            raise ValueError(f"'{key}' has incorrect static value in {metadata}")
    print(f"Validated static metadata keys: {metadata}")

def validate_minter_is_paid(outputs, payment_lovelace):
    minter_payments = [output for output in outputs if str(output.address) == MINTER_ADDRESS]
    if len(minter_payments) != 1:
        raise ValueError(f"Did not find any valid payments to the minter {outputs}")
    payment = minter_payments[0].amount
    if len(payment.multi_asset):
        raise ValueError(f"Attempting to send minter unexpected assets {outputs}")
    if payment.coin != payment_lovelace:
        raise ValueError(f"Payment {payment.coin} does not match expected {payment_lovelace}")
    print(f"Validated payment to minter: {minter_payments}")

def find_send_to_self(outputs):
    assets_sent_to_self = []
    for output in outputs:
        multi_asset = output.amount.multi_asset
        policies = multi_asset.keys()
        if len(policies) != 1:
            continue
        policy = str(next(iter(policies)))
        if policy != TANGZ_POLICY:
            continue
        asset_name = multi_asset.get(TANGZ_SCRIPTHASH)
        asset_name_hex = str(next(iter(asset_name)))
        print(f"Found {asset_name} sent to self")
        yield f"{policy}{asset_name_hex}"

def metadata_name_matches(metadata, base_tangz_name):
    expected = f"{base_tangz_name} - Holiday Mint 2022"
    if metadata['name'] != expected:
        raise ValueError(f"Metadata name '{metadata['name']}' does not match expected '{expected}'")
    print(f"Validated metadata name: {metadata['name']}")

def holiday_changes_are_valid(base_tangz_data, metadata, base_traits, holiday_traits, holiday_values):
    for trait in base_traits:
        if getattr(base_tangz_data, trait) != metadata[trait]:
            raise ValueError(f"Metadata changed '{trait}' to {metadata[trait]}, which is not allowed")
    changed_something = False
    for trait in holiday_traits:
        if getattr(base_tangz_data, trait) == metadata[trait]:
            continue
        if not metadata[trait] in holiday_values[trait]:
            raise ValueError(f"Metadata value '{metadata[trait]}' for '{trait}' invalid")
        changed_something = True
    if not changed_something:
        raise ValueError("You have to change at least one attribute to avoid confusion with original series")
    print(f"Validated new holiday metadata: {metadata}")

def ipfs_image_matches_traits(metadata, pics_dir, nft_storage_key):
    image = holiday_imagegen.compose_image(metadata, pics_dir)
    with BytesIO() as output:
        image.save(output, 'PNG')
        nft_storage_output = holiday_imagegen.upload_to_nft_storage(output.getvalue(), nft_storage_key)
        if not 'ok' in nft_storage_output or not nft_storage_output['ok']:
            raise ValueError(f"Failed to upload combination to NFT.Storage {metadata}")
        ipfs_cid = nft_storage_output['value']['cid']
        if metadata['image'] != ['ipfs://', ipfs_cid]:
            raise ValueError(f"Did not find expected CID '{ipfs_cid}' in {metadata}")
    print(f"Validated IPFS upload of image")

def sign_txn(txn, witnesses, policy_key):
    signing_key = key.PaymentSigningKey.from_cbor(policy_key)
    signature = signing_key.sign(txn.transaction_body.hash())
    txn.transaction_witness_set = witness.TransactionWitnessSet.from_cbor(witnesses)
    txn.transaction_witness_set.native_scripts = [HOLIDAY_NATIVESCRIPT]
    txn.transaction_witness_set.vkey_witnesses.append(
        witness.VerificationKeyWitness(signing_key.to_verification_key(), signature)
    )
    print(f"Successfully signed txn {txn}")
    return txn

def submit_txn(blockfrost, txn):
    with tempfile.NamedTemporaryFile() as txn_file:
        txn_file.write(txn.to_cbor('bytes'))
        txn_file.flush()
        txn_hash = blockfrost.transaction_submit(txn_file.name)
        print(f"Successfully submitted tx {txn_hash}")
        return txn_hash
