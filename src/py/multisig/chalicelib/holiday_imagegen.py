import os
import requests

from PIL import Image

OUTPUT_SIZE = (2100, 2100)
TRAITS = ['fur', 'body', 'accessories', 'eyes', 'eyewear', 'headwear', 'clothing', 'mouth']
BG_COLORS = {
        'Pure White': (255, 255, 255),
        'Deep Gray': (126, 125, 129),
        'Tobacco Brown': (119, 91, 63),
        'Blue Koi': (92, 163, 212),
        'Fountain Blue': (97, 188, 183),
        'Avocado Green': (181, 193, 71),
        'Yellowish Orange': (237, 165, 70),
        'Halloween Orange': (229, 107, 54),
        'Orangy Red': (202, 70, 64),
        'Carmine Pink': (222, 109, 124),
        'Amethyst Purple': (154, 104, 210)
}

NFT_STORAGE_BASE = 'https://api.nft.storage'

def get_layer_path(pics_dir, trait, value):
    return os.path.join(pics_dir, trait, f"{value}.png")

def get_base_image(pics_dir, background):
    try:
        return Image.new('RGBA', OUTPUT_SIZE, BG_COLORS[background])
    except KeyError:
        bg_image = get_layer_path(pics_dir, 'background', background)
        bg_layer = Image.open(bg_image).convert('RGBA')
        image = Image.new('RGBA', OUTPUT_SIZE)
        return Image.alpha_composite(image, bg_layer)

def compose_image(parameters, pics_dir):
    image = get_base_image(pics_dir, parameters['background'])
    for trait in TRAITS:
        filename = get_layer_path(pics_dir, trait, parameters[trait])
        new_layer = Image.open(filename).convert('RGBA')
        image = Image.alpha_composite(image, new_layer)
    return image

def upload_to_nft_storage(image, bearer_token):
    upload_resp = requests.post(f"{NFT_STORAGE_BASE}/upload", data=image, headers={
        'Authorization': f"Bearer {bearer_token}"
    })
    print(f"NFT.Storage Upload: ({upload_resp.status_code})")
    print(upload_resp.text)
    upload_resp.raise_for_status()
    return upload_resp.json()
