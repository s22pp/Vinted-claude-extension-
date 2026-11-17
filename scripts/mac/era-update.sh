#!/bin/bash
# ERA — mise à jour automatique sur Mac. Lancé toutes les heures par launchd (voir install-auto-update.sh).
# Lit la version publiée sur GitHub ; si elle diffère de celle du dossier, télécharge la nouvelle et remplace le
# dossier d'un coup. ERA, chargé depuis ce dossier, voit la nouvelle version et se recharge seul quand rien ne tourne.
# Aucun mot de passe : le dépôt est public. Rien d'autre n'est touché sur le Mac.
set -euo pipefail
REPO="s22pp/Vinted-claude-extension-"
BRANCH="${ERA_BRANCH:-claude/adoring-keller-jahd0y}"
DEST="${ERA_DIR:-$HOME/ERA-extension}"
ver() { grep -o '"version" *: *"[0-9][0-9.]*"' | head -1 | sed 's/.*"\([0-9][0-9.]*\)"$/\1/' || true; }

remote=$(curl -fsS -m 30 "https://raw.githubusercontent.com/$REPO/refs/heads/$BRANCH/extension/manifest.json" | ver) || true
if [ -z "$remote" ]; then echo "$(date '+%F %T') GitHub injoignable : réessai dans une heure"; exit 0; fi
current=$( [ -f "$DEST/manifest.json" ] && ver < "$DEST/manifest.json" || true )
if [ "$remote" = "$current" ]; then exit 0; fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -m 300 "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$tmp/era.tgz"
tar -xzf "$tmp/era.tgz" -C "$tmp"
src=$(ls -d "$tmp"/*/extension | head -1)
got=$(ver < "$src/manifest.json")
if [ "$got" != "$remote" ]; then echo "$(date '+%F %T') version inattendue ($got au lieu de $remote) : rien remplacé"; exit 1; fi

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST.new" "$DEST.old"
cp -R "$src" "$DEST.new"
if [ -d "$DEST" ]; then mv "$DEST" "$DEST.old"; fi
mv "$DEST.new" "$DEST"
rm -rf "$DEST.old"
echo "$(date '+%F %T') ERA ${current:-absent} → $remote"
