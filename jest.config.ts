import {JestConfigWithTsJest} from 'ts-jest'
module.exports = {
  preset: "ts-jest",
  testEnvironment: 'node',
  transform: {
    // '^.+\\.[tj]sx?$' to process js/ts with `ts-jest`
    // '^.+\\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        babelConfig: 'babel.config.json',
      },
    ],
  }
} as JestConfigWithTsJest;