import path from 'path'

export default {
  mode: 'development',
  entry: path.join(import.meta.dirname, 'src', 'index.ts'),
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    path: path.join(import.meta.dirname, 'src'),
    filename: 'bundle.js',
  },
}
