import {Config} from "jest";
const jestConfig: Config = {
  verbose: true,
  preset: null,
  extensionsToTreatAsEsm: ['.ts', ".mts"],
  transform: {
    // '^.+\\.[tj]sx?$' to process js/ts with `ts-jest`
    // '^.+\\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
    '^.+\\.tsx?$':"./node_modules/.tmp/jest-testcase.mjs",
  },
};
export default jestConfig;