{ lib, rustPlatform, fetchFromGitHub, pkg-config, libgit2, rust-jemalloc-sys
, zlib, stdenv, darwin, git }:

rustPlatform.buildRustPackage rec {
  pname = "biome";
  version = "1.7.1";

  src = fetchFromGitHub {
    owner = "biomejs";
    repo = "biome";
    rev = "cli/v${version}";
    hash = "sha256-aBg6SPKx6+fwLZG5ZBUgUpnYBocPOz9pcSN2S1aFLi8=";
  };

  cargoHash = "sha256-52PnFD+VNDSmq61LtlvYpH7vhP94ZqcWZrwRZ3AfgTw=";

  nativeBuildInputs = [ pkg-config ];

  buildInputs = [ libgit2 rust-jemalloc-sys zlib ]
    ++ lib.optionals stdenv.isDarwin [ darwin.apple_sdk.frameworks.Security ];

  nativeCheckInputs = [ git ];

  cargoBuildFlags = [ "-p=biome_cli" ];
  cargoTestFlags = cargoBuildFlags
    ++ [ "-- --skip=diagnostics::test::termination_diagnostic_size" ];

  env = {
    BIOME_VERSION = version;
    LIBGIT2_NO_VENDOR = 1;
  };

  preCheck = ''
    # tests assume git repository
    git init

    # tests assume $BIOME_VERSION is unset
    unset BIOME_VERSION
  '';

  meta = with lib; {
    description = "Toolchain of the web";
    homepage = "https://biomejs.dev/";
    changelog = "https://github.com/biomejs/biome/blob/${src.rev}/CHANGELOG.md";
    license = licenses.mit;
    maintainers = with maintainers; [ figsoda ];
    mainProgram = "biome";
  };
}
