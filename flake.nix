{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };
  outputs = inputs@{ self, nixpkgs, flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      flake = { };
      systems = [ "x86_64-linux" ];
      perSystem = { config, pkgs, ... }: {
        devShells.default = pkgs.mkShell {
          buildInputs = [ pkgs.nodejs_21 ];
          nativeBuildInputs = [ pkgs.biome pkgs.redis pkgs.bashInteractive ];
        };
        formatter = pkgs.nixfmt-rfc-style;
      };
    };
}
