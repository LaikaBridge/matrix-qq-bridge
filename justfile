all:
    just --list
build-wasm:
    cd wasm && wasm-pack build -m no-install -t nodejs
