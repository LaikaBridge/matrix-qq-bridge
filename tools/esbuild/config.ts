import * as esbuild from 'esbuild'
import { Plugin } from "esbuild";
import {createLogger} from '../../src/utils/log'
const logger = createLogger(import.meta);

// https://github.com/hyrious/esbuild-dev/blob/c8cc16251137d7ca3ed897921d89ab1528831996/src/utils.ts#L63
export function external(include: string[]): Plugin {
    const filter = /^[\w@][^:]/;
    return {
      name: "external",
      setup({ onResolve }) {
        onResolve({ filter }, args => {
          if (include.includes(args.path)){
            logger.info(`Marking ${args.path} as external.`);
            return null;
          }
          return { path: args.path, external: true };
        });
      },
    };
  }

export const buildOptions : esbuild.BuildOptions = 
{
  bundle: true,
  platform: "node",
  plugins: [
    external(["data-structure-typed"])
  ],
  format: "esm",
}
