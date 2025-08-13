all:
    just --list
start_dumb:
    export LAIKA_ROOT=./build;  yarn exec esbuild-dev ./packages/bridge/src/bin/dumb.ts | vector --config ./vector.yaml | yarn exec pino-pretty
start:
    export LAIKA_ROOT=./build;  yarn exec esbuild-dev ./packages/bridge/src/index.ts | vector --config ./vector.yaml | yarn exec pino-pretty
