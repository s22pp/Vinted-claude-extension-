#!/bin/bash
# ERA — mise à jour automatique sur Mac. Lancé toutes les heures par launchd (voir install-auto-update.sh).
# Lit la version publiée sur GitHub ; si elle diffère de celle du dossier, télécharge la nouvelle et la copie dans le
# dossier. ERA, chargé depuis ce dossier, voit la nouvelle version et propose « Mettre à jour ERA » (un clic).
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

# Copied INTO the folder, never swapped: an ERA page open on the old version keeps finding its files (old files stay
# until 30 days after they stopped being published); the manifest last, so a half-copied folder never shows a new version.
mkdir -p "$DEST"
(cd "$src" && find . -type f ! -name manifest.json -print0 | while IFS= read -r -d '' f; do mkdir -p "$DEST/$(dirname "$f")"; cp -f "$f" "$DEST/$f"; done)
cp -f "$src/manifest.json" "$DEST/manifest.json.new" && mv -f "$DEST/manifest.json.new" "$DEST/manifest.json"
find "$DEST" -type f -mtime +30 ! -name manifest.json -delete 2>/dev/null || true
echo "$(date '+%F %T') ERA ${current:-absent} → $remote"
