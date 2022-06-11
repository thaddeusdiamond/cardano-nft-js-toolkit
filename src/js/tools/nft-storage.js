import { NFTStorage } from 'nft.storage';

var NftStorageClientCache = {};

function createStorageClient(apiKey) {
  return new NFTStorage({ token: apiKey });
}

function getStorageClient(apiKey) {
  if (!(apiKey in NftStorageClientCache)) {
    NftStorageClientCache[apiKey] = createStorageClient(apiKey);
  }
  return NftStorageClientCache[apiKey];
}

export function uploadFromFileInput(apiKey, fileBody) {
  return getStorageClient(apiKey).storeBlob(fileBody);
}
