#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="obsidian-stock-valuation-plugin"
VAULT_DIR="../second.brain"
TARGET_DIR="${VAULT_DIR}/.obsidian/plugins/${PLUGIN_ID}"

npm run build

rm -rf "${TARGET_DIR}"
mkdir -p "${VAULT_DIR}/.obsidian/plugins"
cp -R "output/${PLUGIN_ID}" "${TARGET_DIR}"

echo "Updated ${TARGET_DIR}"
