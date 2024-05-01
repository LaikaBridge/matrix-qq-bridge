import path from "node:path"
import process_ from "node:process"
import * as esbuild from "esbuild"
import { buildOptions } from "../esbuild/config"
import {AsyncTransformer} from "@jest/transform"
const transformer: AsyncTransformer<void> ={
    async processAsync(sourceText, sourcePath, options){
        const buildResult = await esbuild.build(Object.assign({}, buildOptions, {
            entryPoints: [sourcePath],
            sourcemap: "inline",
            write: false,
        }))
        return {
            code: buildResult.outputFiles![0].text,
        }
    }
}
export default transformer;