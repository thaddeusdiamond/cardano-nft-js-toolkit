import os

from blockfrost import BlockFrostApi, ApiUrls
from chalice import Chalice, Response, BadRequestError
from io import BytesIO

from chalicelib import secrets, holiday_imagegen, holiday_validator

app = Chalice(app_name='multisig')
app.api.binary_types =['*/*']

PICS_DIR = os.path.join(os.path.dirname(__file__), 'chalicelib', 'pics')

@app.route('/generateimage')
def generate_image():
    request = app.current_request
    try:
        image = holiday_imagegen.compose_image(request.query_params, PICS_DIR)
        with BytesIO() as output:
            image.save(output, 'PNG')
            return Response(body=output.getvalue(), status_code=200, headers={'Content-Type': 'image/png'})
    except Exception as e:
        print(e)
        raise BadRequestError(f"An internal server error occurred: {e}")

@app.route('/generateipfs', cors=True)
def generate_ipfs():
    request = app.current_request
    try:
        image = holiday_imagegen.compose_image(request.query_params, PICS_DIR)
        with BytesIO() as output:
            image.save(output, 'PNG')
            return holiday_imagegen.upload_to_nft_storage(output.getvalue(), secrets.NFT_STORAGE_KEY)
    except Exception as e:
        print(e)
        raise BadRequestError(f"An internal server error occurred: {e}")

@app.route('/validatemint', methods=['POST'], cors=True)
def validate_mint():
    request = app.current_request
    try:
        print(request.json_body)
        blockfrost = BlockFrostApi(project_id=secrets.BLOCKFROST_KEY, base_url=ApiUrls.mainnet.value)
        txn = holiday_validator.validated_txn(request.json_body['body'], blockfrost, PICS_DIR, secrets.NFT_STORAGE_KEY)
        txn_signed = holiday_validator.sign_txn(txn, request.json_body['witnesses'], secrets.HOLIDAY_POLICY_KEY)
        txn_hash = holiday_validator.submit_txn(blockfrost, txn_signed)
        return {'ok': True, 'txn_hash': txn_hash}
    except Exception as e:
        print(e)
        raise BadRequestError(f"An internal server error occurred: {e}")
