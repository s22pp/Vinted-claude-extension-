# BIBLE DE DIRECTION ARTISTIQUE & DESIGN SYSTEM — ERA v3.0 (« LOCOMOTIVE MONOLITH »)

**Statut :** spécification canonique, elle fait autorité sur l'ensemble du dépôt.
**Cible :** extension Chrome MV3 (WXT, React 18, TypeScript strict, Dexie, Three.js).
**Standards :** `locomotive.ca` × `linear.app` × `stripe.com` × édition suisse.
**Règle absolue :** aucune logique métier ni aucun calcul financier n'est modifié. La direction artistique s'applique à 100 % des écrans, composants, états vides, modales, graphiques SVG et scènes WebGL. `npm run typecheck && npm test && npm run build` restent au vert.

---

## PARTIE I : MANIFESTE & LOIS FONDAMENTALES

### 1.1. La philosophie « Architectural Brutalism × Editorial Fintech »

ERA n'est pas un outil SaaS grand public. C'est un **instrument de précision financière et logistique**, dessiné comme un manifeste d'architecture suisse. Chaque pixel doit justifier sa présence.

- **L'espace est structuré par la ligne, jamais par l'ombre.** Une interface ne flotte pas : elle est gravée dans une grille continue de `1px`.
- **Le contraste d'échelle crée la hiérarchie.** On n'utilise pas de couleurs criardes pour attirer l'œil : on oppose des titres serif monumentaux à des métadonnées techniques microscopiques.
- **La donnée est sacrée.** Chaque chiffre est aligné verticalement (`tabular-nums`), jamais graissé à outrance, et toujours accompagné de son unité ou de sa source.
- **Le mouvement a du poids.** Les animations ne rebondissent pas (pas de `bounce`, pas de `spring` enfantin). Elles glissent avec une inertie mécanique lourde et précise, comme une porte en acier brossé ou un rail de train.

### 1.2. Liste noire des anti-patterns (interdictions formelles)

- **ZÉRO `box-shadow`** sur les cartes, conteneurs, barres latérales, boutons ou badges.
- **ZÉRO `border-radius` supérieur à `2px`**, sauf les indicateurs circulaires (`50%`, de `5px` à `8px` : point de statut, radar). Aucune « pilule » (`rounded-full`) pour les filtres ou les statuts.
- **ZÉRO dégradé CSS** sur les fonds de pages, les cartes ou les boutons. Les dégradés sont autorisés **exclusivement** à l'intérieur des graphiques SVG de données (sous les courbes et dans les barres verticales).
- **ZÉRO couleur saturée « néon » ni violet générique d'IA.** Pas de `#8B5CF6`, pas de halo flou (`blur-3xl`) derrière les cartes.
- **ZÉRO état vide passif.** Un champ vide (« Inconnu », « Non renseigné ») est une faute d'UX : il devient toujours une action inline cliquable.

---

## PARTIE II : COULEURS, MATÉRIAUX & CONTRASTE WCAG AA

Tous les composants consomment exclusivement ces propriétés CSS, définies dans `:root` et `[data-theme="light"]`.

### 2.1. Mode sombre — « Obsidienne & Acier brossé » (défaut)

```css
:root, [data-theme="dark"] {
  /* Surfaces matérielles */
  --bg-void: #040609;             /* Fond absolu (intro 3D, fond des modales) */
  --bg-canvas: #070A0F;           /* Fond principal de l'application */
  --bg-surface: #0B0F17;          /* Cellules de grille, panneaux, sidebar */
  --bg-surface-elevated: #0F1520; /* Modales, popovers, tooltips, menus */
  --bg-hover: #131A27;            /* Survol subtil de ligne ou de cellule */
  --bg-active: #182132;           /* État pressé */

  /* Architecture de grille (filets 1px) */
  --border-subtle: rgba(255, 255, 255, 0.06); /* Lignes internes de tableaux et grilles de fond */
  --border-grid: rgba(255, 255, 255, 0.10);   /* Structure principale 1px */
  --border-strong: rgba(255, 255, 255, 0.22); /* Focus, survol de carte, séparateurs majeurs */
  --border-pure: #F8FAFC;                     /* Indicateur actif 2px */

  /* Typographie (strictement conforme WCAG AA, ≥ 4,5:1) */
  --text-primary: #F8FAFC;   /* Titres, valeurs KPI, libellés actifs */
  --text-secondary: #A3B1C6; /* Corps de texte, descriptions */
  --text-muted: #8794A7;     /* Métadonnées 10px, axes de graphiques (4,8:1 sur #070A0F) */
  --text-inverse: #070A0F;   /* Texte sur fond blanc glacier */

  /* Accents & sémantique chirurgicale */
  --accent-primary: #F8FAFC; /* Bouton primaire, soulignement actif */
  --accent-primary-hover: #E2E8F0;

  --sem-emerald: #34D399;    /* Profit positif, en ligne, synchronisé, DAC7 OK */
  --sem-emerald-bg: rgba(52, 211, 153, 0.08);
  --sem-emerald-border: rgba(52, 211, 153, 0.28);

  --sem-amber: #FBBF24;      /* Action requise, coût manquant, stagnant, seuil 80 % */
  --sem-amber-bg: rgba(251, 191, 36, 0.08);
  --sem-amber-border: rgba(251, 191, 36, 0.28);

  --sem-coral: #F87171;      /* Alerte critique, retard de colis, perte, seuil 100 % */
  --sem-coral-bg: rgba(248, 113, 113, 0.08);
  --sem-coral-border: rgba(248, 113, 113, 0.28);

  --sem-glacier: #38BDF8;    /* Temps réel, radar de la carte, repère « Maintenant » */
  --sem-glacier-bg: rgba(56, 189, 248, 0.10);
}
```

### 2.2. Mode clair — « Papier d'archive suisse & Encre noire »

```css
[data-theme="light"] {
  --bg-void: #E8E6DF;
  --bg-canvas: #F4F3EE;
  --bg-surface: #FAF9F6;
  --bg-surface-elevated: #FFFFFF;
  --bg-hover: #ECEAE3;
  --bg-active: #E2DFD6;

  --border-subtle: rgba(11, 14, 20, 0.06);
  --border-grid: #D8D6CE;
  --border-strong: #A6A398;
  --border-pure: #0B0E14;

  --text-primary: #0B0E14;
  --text-secondary: #3B4351;
  --text-muted: #58626E; /* Conforme WCAG AA sur #F4F3EE */
  --text-inverse: #FAF9F6;

  --accent-primary: #0B0E14;
  --accent-primary-hover: #1E2430;

  --sem-emerald: #059669;
  --sem-amber: #D97706;
  --sem-coral: #DC2626;
  --sem-glacier: #0284C7;
}
```

---

## PARTIE III : SYSTÈME TYPOGRAPHIQUE MONUMENTAL

### 3.1. Les trois voix typographiques

- **La voix éditoriale (`--font-serif`)** : Instrument Serif, Playfair Display ou Georgia. Uniquement pour les H1 de page, le nom du compte ou de la marque dans l'en-tête de 56px, et le pont 3D.
- **La voix interface (`--font-sans`)** : Geist, Inter ou la sans-serif du système. Pour les phrases explicatives, les noms d'articles, les boutons et les menus.
- **La voix machine (`--font-mono`)** : JetBrains Mono. Pour 100 % des chiffres, prix, pourcentages, dates, heures, références `#001`, étiquettes de colonnes, raccourcis clavier et badges.

### 3.2. Échelle typographique stricte

| Rôle | Police | Taille | Graisse | Interligne | Approche | Casse |
|---|---|---|---|---|---|---|
| H1 monumental | Serif | `clamp(2.25rem, 3.8vw, 3.5rem)` | 400 | 0.94 | -0.035em | normale |
| H2 de section | Sans | 15px | 500 | 1.3 | -0.015em | normale |
| KPI héros (CA, profit) | Mono | 28px | 400 | 1.0 | -0.03em | `tabular-nums` |
| KPI secondaire | Mono | 20px | 400 | 1.1 | -0.02em | `tabular-nums` |
| Corps de texte | Sans | 13px | 400 | 1.5 | 0 | normale |
| Libellé de grille, de KPI | Mono | 10px | 500 | 1.2 | +0.12em | MAJUSCULES |
| Micro-badge, raccourci | Mono | 9.5px | 500 | 1.0 | +0.10em | MAJUSCULES |

### 3.3. Règles optiques

- `font-feature-settings: "tnum" 1, "zero" 1;` sur toute la classe `.mono` (chiffres tabulaires, zéro barré).
- `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;` sur `body`.
- Aucun titre serif n'est jamais en `font-weight: 700` (le gras détruit la finesse des empattements).

---

## PARTIE IV : ARCHITECTURE SPATIALE & GRILLE SUISSE 1PX

### 4.1. Squelette global (AppShell)

L'application entière est une matrice orthogonale divisée par des filets `1px solid var(--border-grid)` :

- **Sidebar gauche** : largeur fixe `220px`, `border-right: 1px solid var(--border-grid)`.
- **En-tête unifié (hauteur 56px stricte)** : la ligne inférieure de l'en-tête de la sidebar (56px) et celle de la barre supérieure (56px) forment une seule ligne continue, sur 100 % de la largeur de l'écran.
- **Zone de contenu principale** : marge horizontale `32px`, verticale `28px`, avec `padding-bottom: 48px` pour que le bas des grilles ne soit jamais rogné.

### 4.2. Coin supérieur gauche (56px × 220px) — identité Vinted locale

- Aucun badge étiquette blanc.
- Disposition flex alignée verticalement (`padding: 0 16px`, `gap: 12px`) :
  - **Avatar (32px × 32px)** : carré, `border-radius: 2px`, `border: 1px solid var(--border-strong)`, `object-fit: cover`. Il affiche la photo de profil Vinted locale, ou un monogramme serif « E » sur `#0F1520` avant l'import.
  - **Bloc texte** :
    - ligne 1 : le pseudo Vinted (ou « ERA ») en serif 18px, `line-height: 1`, tronqué ;
    - ligne 2 : un point de 5px (`#34D399` si synchronisé, `#FBBF24` sinon) et « COMPTE ACTIF » en mono 9.5px.

### 4.3. Barre supérieure compartimentée (TopBar — 56px)

Aucun bouton flottant. Chaque bloc est une cellule pleine hauteur (`height: 56px`), séparée par `border-left: 1px solid var(--border-grid)` :

- **Cellule contexte** (à gauche, `flex-none`) : `MER. 25 NOV | ● STOCK : 3` (mono 10.5px).
- **Cellule commande** (au centre, `flex-1`) : zone `Ctrl + K` cliquable sur toute la hauteur, loupe de 13px, texte « Rechercher un article, une commande, une action… » et touche `[ CTRL K ]` à droite.
- **Cellule `[ ↻ Actualiser ]`** : pleine hauteur, fond transparent, survol en balayage.
- **Cellule `[ Achats ]`** : pleine hauteur, fond transparent, survol en balayage.
- **Cellule thème (56px × 56px)** : icône géométrique ◐ centrée.
- **Cellule `[ + Ajouter ]`** : pleine hauteur, fond `var(--accent-primary)`, texte `var(--text-inverse)`, collée au bord droit.

### 4.4. Navigation latérale architecturale

- **Items** : hauteur `36px`, marge gauche `20px`.
- **Inactif** : texte `var(--text-muted)`, icône filaire de 14px (`stroke-width: 1.5`).
- **Actif** : aucun fond arrondi. Une barre verticale blanche de 2px (`var(--border-pure)`) collée à `left: 0`, texte `var(--text-primary)`, décalage `transform: translateX(6px)`.
- **Pied de la sidebar** : collé en bas (`border-top: 1px solid var(--border-grid)`). Il affiche Outils, Réglages, puis une ligne système discrète : `ERA v3.0 · ● PILOTE ACTIF`.

---

## PARTIE V : PHYSIQUE CINÉTIQUE & MICRO-INTERACTIONS (« LOCOMOTIVE MOTION »)

### 5.1. Courbes de référence

```css
:root {
  --ease-locomotive: cubic-bezier(0.19, 1, 0.22, 1); /* Décélération exponentielle signature */
  --ease-snappy: cubic-bezier(0.25, 1, 0.5, 1);      /* Micro-interactions rapides */
  --dur-fast: 180ms;
  --dur-base: 320ms;
  --dur-reveal: 650ms;
}
```

### 5.2. Les cinq signatures d'animation

- **Révélation masquée du H1** : chaque H1 de page est dans un conteneur `overflow: hidden`. Au montage : de `transform: translateY(105%) rotate(1.2deg); opacity: 0;` à `transform: translateY(0) rotate(0); opacity: 1;`, en 650ms `var(--ease-locomotive)`.
- **Balayage au survol (boutons secondaires 1px)** : un pseudo-élément `::before` en `var(--accent-primary)` passe de `clip-path: inset(100% 0 0 0)` à `clip-path: inset(0 0 0 0)` en 300ms `var(--ease-locomotive)`, pendant que le texte passe en `var(--text-inverse)`.
- **Entrée en cascade de la grille** : les cellules de KPI et les cartes du Stock apparaissent en cascade (`animation-delay: calc(var(--index) * 35ms)`), avec un glissement vertical de 10px (jamais de zoom ni de `scale`).
- **Soulignement glissé (onglets secondaires)** : la ligne blanche de 2px sous l'onglet actif glisse d'un onglet à l'autre en 280ms `var(--ease-locomotive)`.
- **Accessibilité** : sous `@media (prefers-reduced-motion: reduce)` ou avec le réglage interne « Animations : réduites », toutes les durées passent à 0,01ms et les translations sont désactivées.

---

## PARTIE VI : BIBLIOTHÈQUE DE COMPOSANTS ATOMIQUES

### 6.1. Grilles de KPI (KpiStrip)

- Conteneur `border: 1px solid var(--border-grid)`, `background: var(--bg-surface)`, `display: grid`.
- Séparation entre colonnes : `border-right: 1px solid var(--border-grid)` (jamais d'espace vide entre des cartes flottantes).
- **Règle zéro inconnu** : une valeur qui dépend d'un coût d'achat manquant affiche « — » en `var(--text-muted)`, avec juste en dessous un micro-bouton ambre (`var(--sem-amber)`, mono 10.5px, `text-decoration: underline; text-underline-offset: 3px`) : « + Renseigner (X) » ou « + Saisir le coût ».

### 6.2. Saisie inline « friction zéro »

- Cliquer sur un coût manquant ou un emplacement physique (`storageLocation`) remplace le texte sur place par un `<input>` sans bordure extérieure (`border-bottom: 1px solid var(--accent-primary)`, `background: transparent`, JetBrains Mono, `autoFocus`).
- Entrée enregistre dans Dexie avec un flash émeraude discret (300ms) ; Échap annule.

### 6.3. Barres d'onglets secondaires (SubTabs)

- Ligne pleine largeur `border-bottom: 1px solid var(--border-grid)`, `gap: 24px`.
- Onglet actif : `color: var(--text-primary)`, bordure inférieure `2px solid var(--border-pure)` superposée au pixel près à celle du conteneur (`margin-bottom: -1px`).

### 6.4. Palette de commandes (Ctrl + K)

- Fond `rgba(4, 6, 9, 0.72)` avec `backdrop-filter: blur(6px)`.
- Conteneur centré `max-width: 600px`, `border: 1px solid var(--border-strong)`, `border-radius: 2px`, `background: var(--bg-surface-elevated)`.
- Navigation intégrale au clavier (↑, ↓, Entrée, Échap), la ligne active marquée par un filet gauche blanc de 2px.

---

## PARTIE VII : DATA VISUALIZATION HAUTE PRÉCISION (SVG)

### 7.1. Courbes temporelles (Ventes → revenus et profit mensuels)

- **Grille de fond** : lignes horizontales pointillées, `stroke-dasharray="2 4"`, `stroke="var(--border-subtle)"`.
- **Interpolation monotone (`monotoneX`)** : contrainte stricte `y <= yZero`, pour qu'aucun tracé ni dégradé ne descende visuellement sous la ligne 0 €.
- **Tracé du CA** : `stroke="#E2E8F0"`, `stroke-width="1.75"`, dégradé vertical sous la courbe de `rgba(226, 232, 240, 0.14)` vers 0.
- **Tracé du profit** : `stroke="#34D399"`, `stroke-width="1.75"`, dégradé vertical de `rgba(52, 211, 153, 0.16)` vers 0.
- **Interaction** : ligne verticale repère au survol (1px pointillé `var(--border-strong)`) et infobulle sombre à filet 1px, valeurs exactes en JetBrains Mono.

### 7.2. Histogrammes (Comptabilité → recettes par mois)

- Barres architecturales (`max-width: 22px`, `border-radius: 1px 1px 0 0`), dégradé vertical `#34D399` → `rgba(52, 211, 153, 0.18)`, chapeau lumineux `1px solid #6EE7B7`.
- Valeur exacte en JetBrains Mono 10px, centrée à 6px au-dessus de chaque barre non nulle.

### 7.3. Jauges fiscales DAC7

- Piste fine : `height: 5px`, `border-radius: 1px`, fond `rgba(255, 255, 255, 0.06)`.
- Repère vertical gravé à 80 % (`1px solid var(--border-strong)`).
- Couleur dynamique : `#34D399` (< 80 %), `#FBBF24` (80 % à 99 %), `#F87171` (≥ 100 %).

---

## PARTIE VIII : DIRECTION ARTISTIQUE 3D & WEBGL (THREE.JS)

### 8.1. Scène d'introduction (`<EraTrainScene />`)

- **Ambiance** : un tunnel architectural en béton sombre (`#040609`). Des néons linéaires blancs au plafond rythment la vitesse du wagon brutaliste ERA-01.
- **Plan final sur le pont** :
  - caméra stabilisée, parfaitement centrée face à l'arche (`camera.lookAt(0, bridgeY, bridgeZ)`) ;
  - `DirectionalLight` froide (`#E2E8F0`, intensité 2.4) révélant le volume du pont et ses arêtes `EdgesGeometry` (`#94A3B8`, opacité 0.35) ;
  - nom gravé (le pseudo local, ou « ERA ») : texture canvas 2048×512, serif `#F8FAFC`, matériau émissif subtil (`emissiveIntensity: 0.65`) pour une lisibilité parfaite ;
  - feux arrière corail (`#F87171`) sur le dernier wagon, qui s'éloigne sous l'arche.
- **Interface de fin** : `[ SYSTÈME PRÊT ]` apparaît au centre avec le bouton « Accéder à l'espace → », et « Passer l'intro (Échap) » disparaît aussitôt.

### 8.2. Showroom « Boutique 3D » (Stock → Boutique 3D)

- **Sol** : béton ciré obsidienne `#0B1018`, grille architecturale `rgba(148, 163, 184, 0.14)`.
- **Portants** : tubes d'acier brossé mat (`#475569`, `#94A3B8`), silhouettes adaptées à la catégorie (veste, pantalon ou jean, haut).
- **Enseignes uniformisées** : étiquettes HTML 3D ou sprites de taille fixe à l'écran (`sizeAttenuation: false`, mono 11px, fond `#070A0F`, bordure `1px solid var(--border-strong)`, point de statut de 6px).
- **Hygiène GPU** : `devicePixelRatio` plafonné à 1.5, `requestAnimationFrame` en pause quand l'onglet est masqué, `dispose()` intégral au démontage.

---

## PARTIE IX : CHECKLIST D'EXÉCUTION & QA VISUELLE

La refonte s'exécute en quatre passes ordonnées, avec `npm test` après chacune :

1. **Fondations** : tokens CSS (sombre et clair), polices, suppression globale des `box-shadow` et des `border-radius` > 2px, classes d'animation Locomotive.
2. **Squelette 56px** : refonte unifiée de l'en-tête de la sidebar (avatar et pseudo Vinted) et de la barre supérieure compartimentée, navigation latérale à filet de 2px.
3. **Composants & DataViz** : grilles de KPI sans « Inconnu » statique, saisies inline, onglets secondaires, graphiques SVG monotones et jauges DAC7.
4. **WebGL & validation** : éclairage du pont 3D, enseignes uniformisées de la Boutique 3D, puis `npm run typecheck && npm test && npm run build` obligatoires.
