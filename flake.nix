{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    pre-commit-hooks-nix.url = "github:cachix/pre-commit-hooks.nix";
  };
  outputs = inputs@{ self, nixpkgs, flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      flake = { };
      imports = [ inputs.pre-commit-hooks-nix.flakeModule ];
      systems = [ "x86_64-linux" ];
      perSystem = { config, pkgs, self', ... }: {
        devShells.default = pkgs.mkShell {
          buildInputs = [ pkgs.nodejs_21 ];
          nativeBuildInputs =
            [ pkgs.redis pkgs.bashInteractive self'.packages.biome ];
          shellHook = ''
            ${config.pre-commit.installationScript}
          '';
        };
        packages.biome = pkgs.callPackage ./tools/biome.nix { };
        formatter = pkgs.nixfmt-rfc-style;
        pre-commit.check.enable = true;
        pre-commit.settings = {
          hooks = {
            nixfmt.enable = true;
            biome = {
              enable = true;
              settings.binPath = "${self'.packages.biome}/bin/biome";
              settings.configPath = "${./.}";
            };
          };
        };
      };
    };
}
