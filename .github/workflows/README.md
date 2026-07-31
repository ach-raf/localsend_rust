# Build and release workflow

`build-release.yml` builds Windows, Linux, and Android packages on every push to
`master` and on manual dispatch. Successful runs publish a combined GitHub
Release tagged `vYYYY.MM.DD-<run-number>`.

Developer prerequisites, local build commands, artifact details, and the release
flow are documented in [DEVELOPMENT.md](../../DEVELOPMENT.md). Android keystore
setup and signature behavior are documented in
[ANDROID_SIGNING.md](../../ANDROID_SIGNING.md).
