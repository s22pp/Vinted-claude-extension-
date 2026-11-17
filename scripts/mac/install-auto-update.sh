#!/bin/bash
# ERA — installe la mise à jour automatique sur ce Mac (une seule fois). Dans le Terminal :
#   curl -fsSL https://raw.githubusercontent.com/s22pp/Vinted-claude-extension-/refs/heads/claude/adoring-keller-jahd0y/scripts/mac/install-auto-update.sh | bash
# Ce que ça fait : un petit script dans ~/Library/Application Support/ERA, lancé toutes les heures (et au démarrage du
# Mac) par launchd, qui tient à jour le dossier ~/ERA-extension. Désinstaller : uninstall-auto-update.sh.
set -euo pipefail
RAW="https://raw.githubusercontent.com/s22pp/Vinted-claude-extension-/refs/heads/claude/adoring-keller-jahd0y/scripts/mac"
SUPPORT="$HOME/Library/Application Support/ERA"
AGENT="$HOME/Library/LaunchAgents/fr.era.update.plist"
mkdir -p "$SUPPORT" "$HOME/Library/LaunchAgents"
curl -fsSL "$RAW/era-update.sh" -o "$SUPPORT/era-update.sh"
chmod +x "$SUPPORT/era-update.sh"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>fr.era.update</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SUPPORT/era-update.sh</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$SUPPORT/update.log</string>
  <key>StandardErrorPath</key><string>$SUPPORT/update.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"
/bin/bash "$SUPPORT/era-update.sh"
echo
echo "Mise à jour automatique installée. Dossier d'ERA : $HOME/ERA-extension"
echo "Une seule fois dans Chrome : chrome://extensions → Mode développeur → « Charger l'extension non empaquetée » → choisir le dossier ERA-extension (dans votre dossier personnel)."
echo "Vos données restent : ERA garde le même identifiant, quel que soit le dossier."
open "$HOME" 2>/dev/null || true
