import * as esbuild from 'esbuild'
import {buildOptions} from "./config"
await esbuild.build(Object.assign({}, {
  entryPoints: ['src/bin/*.ts', 'src/tools/*.ts'],
  outdir: 'build/',
  splitting: true,
  sourcemap: "inline",
}, buildOptions))
