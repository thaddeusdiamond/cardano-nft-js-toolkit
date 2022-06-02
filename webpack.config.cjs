const copyplugin = require('copy-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

module.exports = {
  context: path.join(__dirname, 'src'),
  entry: './js/mint-frontend.js',

  experiments: {
    asyncWebAssembly: true,
    topLevelAwait: true,
    layers: true // optional, with some bundlers/frameworks it doesn't work without
  },

  output: {
    filename: 'mint-frontend-bundle.js',
    library: 'mintFrontend'
  },

  plugins: [
        // Work around for Buffer is undefined:
        // https://github.com/webpack/changelog-v5/issues/10
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
        }),
        new webpack.ProvidePlugin({
            process: 'process/browser',
        }),

        new copyplugin({
          patterns: [
            { from: 'static' }
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
