import jestConfig from "./jest.config";
import jest from "jest";
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir as _tmpdir } from "os";
import { buildOptions } from "../esbuild/config";
const jestConfigJson = JSON.stringify(jestConfig);

function findNodeModules(dir: string): string | undefined {
    const path = join(dir, "node_modules");
    if (existsSync(path) && statSync(path).isDirectory()) {
      return path;
    } else {
      const parent = dirname(dir);
      if (parent !== dir) {
        return findNodeModules(parent);
      }
    }
    return;
  }
export const tempDirectory =  (() =>
    join(findNodeModules(process.cwd()) || _tmpdir(), ".tmp"))();

if (!existsSync(tempDirectory)) {
    mkdirSync(tempDirectory, { recursive: true });
    writeFileSync(join(tempDirectory, "package.json"), '{"type":"module"}');
}


// run esbuild to build jest-testcase.mjs
await esbuild.build(Object.assign({}, {
    entryPoints: [join(process.cwd(), "tools/jest/jest-testcase.ts")],
    outfile: join(tempDirectory, "jest-testcase.mjs"),
    sourcemap: "inline",
}, buildOptions));


// run jest process
const argv = process.argv.slice(2);

await jest.run([
    "--config", jestConfigJson, "--no-cache", ...argv
])