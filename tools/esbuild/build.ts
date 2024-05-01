import * as esbuild from 'esbuild'
import {buildOptions} from "./config"
await esbuild.build(Object.assign({}, {
  entryPoints: ['src/broker/QQBroker.ts', 'src/broker/MatrixBroker.ts'],
  outdir: 'build/',
  splitting: true
}, buildOptions))
