# ERA Intelligence

Cockpit de décision pour revendeurs Vinted. **Redrip exécute, ERA décide.**
Extension Chrome MV3 · WXT · React · TypeScript strict · Dexie (IndexedDB) · local-first, aucune télémétrie.

## Installer (Chrome) — sans rien compiler

1. Télécharger le dépôt (ZIP) et le décompresser.
2. Ouvrir `chrome://extensions` → activer **Mode développeur** (en haut à droite).
3. **Charger l'extension non empaquetée** → choisir le dossier **`extension/`** (celui qui contient `manifest.json`),
   pas la racine du dépôt.

## Mettre à jour sans retélécharger

Installer **une seule fois** avec git, dans un dossier fixe :

```bash
git clone -b claude/adoring-keller-jahd0y https://github.com/s22pp/Vinted-claude-extension-.git ~/ERA
```
puis charger `~/ERA/extension` dans `chrome://extensions`.

Ensuite, à chaque nouvelle version :

```bash
~/ERA/scripts/update.sh      # = git pull
```
puis **Réglages → Recharger ERA** (ou ↻ dans `chrome://extensions`). L'identifiant de l'extension est fixé
(clé publique dans le manifest) : vos données locales sont conservées d'une version à l'autre.

Pour développer : `npm install && npm run build` (sortie `.output/chrome-mv3`) ; `npm run release` régénère `extension/` et le ZIP.

Premier lancement : onboarding. Importer depuis Vinted (onglet vinted.fr connecté, lecture seule, ≤ 5 requêtes), CSV, saisie, ou démo clairement étiquetée.

## Développer / tester

```bash
npm run dev            # WXT + rechargement à chaud
npm test               # Vitest — moteurs (argent, comparables, pricing, stagnation, capital, deal score, offres, apprentissage)
npm run e2e            # build + Playwright sur l'extension chargée
npm run compile        # tsc strict
npm run qa:screens     # build + captures pleine page des écrans clés (démo) → .output/screens
npm run icons          # régénère les PNG depuis assets/era-mark.svg
```

## Architecture

```
src/domain         entités (Zod), argent en centimes (UNKNOWN ≠ 0), provenance
src/data           Dexie, repository, adapters (démo / Vinted lecture seule + budget d'appels), import CSV/Vinted
src/intelligence   moteurs purs : comparables, pricing, stagnation, capital, seller model, buy/deal score,
                   offres, annonce + bouclier, apprentissage, décision
src/app            écrans React (Today, Stock + Capital, Item, Market, Buy, Sales, Insights, Outils, Réglages), popup, side panel
src/ui             design system : tokens, composants, graphiques SVG, illustrations, logo
```

## Garde-fous Vinted

- Endpoints vérifiés uniquement, `GET` seulement, via la session de l'onglet ouvert.
- Budget : 60 appels / session · 12 / min · 1,2 s d'espacement · 2 pages max. **403/429 = arrêt total 6 h.**
- ERA ne publie, ne republie, ne supprime, n'envoie aucune offre ni message, ne suit personne et ne change jamais un prix automatiquement.
- Seule exception, **EXPERIMENTAL et gelée** : modifier le prix d'une annonce depuis la fiche article, un article à la fois, après confirmation explicite. Elle n'est pas améliorée et peut cesser de fonctionner si Vinted change sa page.

## Ce qui est vérifié — et ce qui ne l'est pas

Les tests automatiques utilisent des données fictives : **ils prouvent la logique d'ERA, pas le fonctionnement réel de Vinted.**
Réglages → *Intégrations Vinted* affiche, pour cet appareil, ce qui a réellement été observé (import du stock, ventes, statut réservé, recherche de comparables, achats) et marque le reste **NON VÉRIFIÉ**.

| Intégration | Statut |
| --- | --- |
| Import garde-robe, ventes | utilisé en réel, champs non garantis |
| Statut « réservé » (`is_reserved`) | NON VÉRIFIÉ |
| Recherche de comparables (point d'accès appris après un 404) | NON VÉRIFIÉ |
| Achats (Mes commandes → Achats) | NON VÉRIFIÉ |
| Modification de prix | EXPERIMENTAL (gelée) |
