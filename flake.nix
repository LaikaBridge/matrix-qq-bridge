{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
  description = "A very basic flake";

  outputs = { self, nixpkgs, rust-overlay }: {
    devShells.x86_64-linux.default = let
      overlays = [(import rust-overlay)];
      pkgs = import nixpkgs { system = "x86_64-linux"; inherit overlays; };
    in pkgs.mkShell {
      buildInputs = with pkgs; [
        nodejs
        biome
        ffmpeg-full
        imagemagick
        bashInteractive
        (rust-bin.stable.latest.default.override {
          extensions = ["rust-src" "rust-analyzer"];
          targets = ["wasm32-unknown-unknown"];
        })
        wasm-bindgen-cli
        wasm-pack
        just
      ];
    };
  };
}
