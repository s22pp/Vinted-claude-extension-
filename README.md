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
src/app            écrans React (Today, Stock + Mise en ligne + Capital, Item, Market, Buy, Sales + Comptabilité,
                   Insights, Outils, Réglages), facture imprimable, popup, side panel
src/ui             design system : tokens, composants, graphiques SVG, illustrations, logo
```

## Garde-fous Vinted

- Lecture : endpoints vérifiés, `GET`, via la session de l'onglet ouvert. Écriture : seulement les automatisations activées (ci-dessous).
- Budget : 60 appels / session · 12 / min · 1,2 s d'espacement · 2 pages max. **403/429 = arrêt total 6 h.**
- ERA ne publie, ne republie, ne supprime, ne suit personne et ne change jamais un prix automatiquement.
- Modifier le prix d'une annonce depuis la fiche article : **EXPERIMENTAL**, un article à la fois, après confirmation explicite.
- **Automatisations (EXPERIMENTAL, désactivées par défaut)** — Outils → Automatisations :
  - *Favoris → message et offre* : à un nouveau favori, un message et (si le coût d'achat est connu) une offre, jamais sous coût + marge ;
  - *Offres reçues* : acceptée au-dessus d'un seuil, une contre-offre entre deux, refusée en dessous — jamais sous le plancher.
  - Écritures limitées à une **liste blanche** de 5 routes (conversation, message, offre, réponse à une offre) ; 12 s minimum entre deux envois, 40 par jour, 5 par passage ; tout reste dans le budget de lecture ; 403/429, déconnexion ou budget épuisé = arrêt immédiat.
  - « Simuler » ne fait que lire ; chaque action (ou simulation) est écrite dans un **journal**. La planification ne tourne qu'avec un onglet vinted.fr déjà ouvert.
  - Routes et champs relevés dans des extensions du marché (faits d'interopérabilité, aucun code repris) : **NON VÉRIFIÉS** sur votre compte tant que le journal ne les montre pas fonctionner.
- **Brouillon Vinted pré-rempli (EXPERIMENTAL)** — Atelier → « Créer le brouillon sur Vinted » : titre, description, prix, état, et les identifiants que Vinted lui-même propose (catégorie suggérée pour le titre, marque au nom exact, taille exacte de la catégorie, format de colis). Ce qui ne correspond pas reste vide. **Jamais publié** : vous ajoutez les photos et publiez sur Vinted. Relu sur Vinted avant d'être annoncé.

## Code tiers

Des extensions commerciales ont été examinées uniquement pour relever des **faits d'interopérabilité** (noms de routes et de champs de l'API Vinted). **Aucune ligne de leur code n'est reprise** : leur code est protégé par le droit d'auteur. Les fonctionnalités d'ERA sont écrites de zéro.

## Ce qui est vérifié — et ce qui ne l'est pas

Les tests automatiques utilisent des données fictives : **ils prouvent la logique d'ERA, pas le fonctionnement réel de Vinted.**
Réglages → *Intégrations Vinted* affiche, pour cet appareil, ce qui a réellement été observé (import du stock, ventes, statut réservé, recherche de comparables, achats) et marque le reste **NON VÉRIFIÉ**.

| Intégration | Statut |
| --- | --- |
| Import garde-robe, ventes | utilisé en réel, champs non garantis |
| Statut « réservé » (`is_reserved`) | NON VÉRIFIÉ |
| Recherche de comparables (`catalog/items`, en-têtes CSRF/anon_id de la page ; replis : forme sans tri, puis apprentissage) | NON VÉRIFIÉ |
| Achats (`my_orders?type=purchased`, repli : apprentissage depuis la page Mes commandes) | NON VÉRIFIÉ |
| Commandes « à traiter » (`transaction_user_status: needs_action` dans `my_orders`) | NON VÉRIFIÉ |
| Modification de prix | EXPERIMENTAL |
| Automatisations : notifications de favoris, conversations, messages, offres (`/web/api/notifications/notifications`, `/api/v2/conversations`, `/api/v2/transactions/{id}/offers`, `offer_requests/{id}/accept\|reject`, `/api/v2/inbox`) | EXPERIMENTAL · NON VÉRIFIÉ |

## Republications : un article, une mémoire

Republier (supprimer puis remettre en ligne, à la main ou avec n'importe quel outil) donne à l'annonce un nouvel identifiant Vinted, 0 vue et 0 favori. ERA ne crée pas pour autant un nouvel article :

- **Rapprochement à l'import** : une annonce qui disparaît de la garde-robe (lue en entier) et une nouvelle annonce avec la **référence ERA** dans le titre (certain) ou le **même titre, même marque, même taille** (déduit) sont le même article. Coût, date d'achat, historique des prix et prédictions sont conservés. Fenêtre : 30 jours après la disparition.
- **Âges** : la 1re mise en ligne compte pour le capital immobilisé, la stagnation et vos délais de vente ; vues et favoris viennent de l'annonce actuelle.
- **Historique** : « Annonce retirée » puis « Republié », avec les vues et favoris que Vinted a remis à zéro. Rapprochement faux (deux exemplaires, un titre) ? « Séparer » dans l'historique de l'article.
- **Décisions** : aucune autre action proposée pendant 7 jours après une republication (son effet sur les vues est mesuré) ; une republication sans effet n'est pas reproposée.
- **Disparition sans republication** : l'annonce passe « retirée » et l'article sort du stock (déduit) ; si une commande la nomme, c'est une vente.
- Garde-robe de plus de 192 annonces (2 pages lues) : ERA ne conclut rien d'une absence.

## Liste de courses

Buy → **Liste de courses** : à partir de **vos** ventes (jamais du marché seul), chaque niche vendue au moins 3 fois avec son prix encaissé médian, son délai, son profit par jour (si les coûts sont connus), le stock déjà détenu et le **prix maximal à payer** : prix encaissé médian − max(8 €, 40 %), traduit en prix affiché sur Vinted (protection acheteur 0,70 € + 5 % incluse, port en plus). « À éviter » : profit par vente trop faible, profit par jour très inférieur à l'habitude, ou lenteur quand le profit est inconnu. Une marque inconnue n'est jamais une niche.

## Approvisionnement hors Vinted

Sur la page produit d'une autre boutique, le popup ERA propose **« Lire ce produit »** : un script ponctuel, lancé par votre clic (`activeTab` + `scripting`), copie la fiche produit que la page publie déjà (JSON-LD schema.org, sinon balises OpenGraph `product:*`) puis ouvre l'analyse d'achat préremplie. Aucune requête réseau, aucune lecture en arrière-plan ; un prix dans une autre devise reste inconnu (jamais converti).
