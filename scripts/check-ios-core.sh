#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if ! command -v swiftc >/dev/null 2>&1; then
  echo "Swift compiler not found. Run this on the Mac with Xcode installed."
  exit 1
fi
# Keep the small test executable in ignored project output; do not delete directories.
mkdir -p .local/ios-checks
swiftc ios/App/App/LocalSyncPairing.swift scripts/ios-tests/PairingChecks.swift -o .local/ios-checks/pairing-checks
.local/ios-checks/pairing-checks scripts/ios-tests/pairing-cases.json
