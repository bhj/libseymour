import path from 'path'

export default {
  mode: 'development',
  entry: path.join(import.meta.dirname, 'src', 'main.ts'),
  output: {
    path: path.join(import.meta.dirname, 'src'),
    filename: 'bundle.js',
  },
  plugins: [
  ],
}
