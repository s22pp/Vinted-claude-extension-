#!/bin/bash
# ERA — retire la mise à jour automatique (le dossier ~/ERA-extension et ERA dans Chrome restent tels quels).
set -uo pipefail
AGENT="$HOME/Library/LaunchAgents/fr.era.update.plist"
launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
rm -f "$AGENT"
rm -rf "$HOME/Library/Application Support/ERA"
echo "Mise à jour automatique retirée."
