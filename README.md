# ERA Intelligence

Cockpit de décision pour revendeurs Vinted. **Redrip exécute, ERA décide.**
Extension Chrome MV3 · WXT · React · TypeScript strict · Dexie (IndexedDB) · local-first, aucune télémétrie.

## Installer (Chrome)

```bash
npm install
npm run build          # → .output/chrome-mv3
```
`chrome://extensions` → Mode développeur → **Charger l'extension non empaquetée** → `.output/chrome-mv3`.

Premier lancement : onboarding. Importer depuis Vinted (onglet vinted.fr connecté, lecture seule, ≤ 5 requêtes), CSV, saisie, ou démo clairement étiquetée.

## Développer / tester

```bash
npm run dev            # WXT + rechargement à chaud
npm test               # Vitest — moteurs (argent, comparables, pricing, stagnation, capital, deal score, offres, apprentissage)
npm run e2e            # build + Playwright sur l'extension chargée
npm run compile        # tsc strict
npm run icons          # régénère les PNG depuis assets/era-mark.svg
```

## Architecture

```
src/domain         entités (Zod), argent en centimes (UNKNOWN ≠ 0), provenance
src/data           Dexie, repository, adapters (démo / Vinted lecture seule + budget d'appels), import CSV/Vinted
src/intelligence   moteurs purs : comparables, pricing, stagnation, capital, seller model, buy/deal score,
                   offres, annonce + bouclier, apprentissage, décision
src/app            écrans React (Today, Stock, Item, Market, Buy, Sales, Insights, Outils, Réglages), popup, side panel
src/ui             design system : tokens, composants, graphiques SVG, illustrations, logo
```

## Garde-fous Vinted

- Endpoints vérifiés uniquement, `GET` seulement, via la session de l'onglet ouvert.
- Budget : 60 appels / session · 12 / min · 1,2 s d'espacement · 2 pages max. **403/429 = arrêt total 6 h.**
- ERA ne publie, ne republie, ne like, ne suit et n'écrit jamais rien sur Vinted.
