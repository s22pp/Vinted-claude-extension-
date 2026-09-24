#!/usr/bin/env sh
# Met à jour ERA sans rien retélécharger : récupère la dernière version, puis rechargez l'extension.
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
echo "ERA à jour (v$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' extension/manifest.json)). Cliquez sur « Recharger ERA » dans Réglages, ou ↻ dans chrome://extensions."
