const copyplugin = require('copy-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

module.exports = {
  context: path.join(__dirname, 'src'),
  entry: './js/library.js',

  experiments: {
    asyncWebAssembly: true,
    outputModule: true,
    topLevelAwait: true,
    layers: true // optional, with some bundlers/frameworks it doesn't work without
  },

  output: {
    environment: { module: true },
    filename: 'nft-toolkit.js',
    library: { type: 'module' }
  },

  plugins: [
        // Work around for Buffer is undefined:
        // https://github.com/webpack/changelog-v5/issues/10
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer']
        }),

        new copyplugin({
          patterns: [
            { from: 'static/**/*', to: '[name][ext]' }
          ]
        }),

        new webpack.optimize.LimitChunkCountPlugin({
          maxChunks: 1, // disable creating additional chunks
        })
  ],

  resolve: {
    extensions: ['.js'],
    fallback: {
      buffer: require.resolve('buffer')
    }
  }

};
