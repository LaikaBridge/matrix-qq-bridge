{

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
  };
  description = "A very basic flake";

  outputs = { self, nixpkgs }: {
    devShells.x86_64-linux.default = let pkgs = import nixpkgs {system = "x86_64-linux"; }; in pkgs.mkShell{
        buildInputs = [pkgs.nodejs];
    };

  };
}
