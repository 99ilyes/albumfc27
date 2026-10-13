# Extensions FC 27 Web App

- `SnipeFC27/` : autobuyer existant (achat sous le prix, revente avec marge).
- `AlbumFC27/` : complète automatiquement la **Galerie** FC 27 jusqu'au niveau 10.

## AlbumFC27 : utilisation

1. Chrome > `chrome://extensions` > Mode développeur > Charger l'extension non empaquetée > dossier `AlbumFC27`.
2. Ouvrir la Web App FC 27. Le panneau s'affiche à gauche.
3. Facultatif : saisir le score Galerie actuel lu dans le jeu, pour s'arrêter pile à l'objectif.
4. Cliquer sur **Lancer le niveau 10 automatique**. C'est tout.

L'extension tourne ensuite seule : elle attend quand les quotas ou les crédits sont épuisés, reprend après un rechargement de la Web App, et s'arrête quand l'objectif (3 000 000 points, estimation communautaire) est atteint. Laisser l'onglet ouvert au premier plan.

## Fonctionnement

- Achète les joueurs or 84+ pas encore dans la Galerie (champ `isCollected` des réponses EA), entre 650 et 15 000 crédits, en privilégiant le meilleur rapport points / crédits (`gradingScore` EA, plafond 1,4 crédit par point).
- Remet chaque carte en vente à son prix d'achat (la carte reste comptée dans la Galerie), encaisse les ventes, remet les invendus au même prix.
- Coût réel : la taxe EA de 5 % par carte vendue, environ 0,065 crédit par point, soit environ 200 000 crédits pour 3 millions de points.

Le menu **Avancé** garde les anciennes options (ensembles personnalisés capturés depuis une recherche du marché, délais, quotas, rapport Galerie).

## Garde-fous

Repris de SnipeFC27 : délais aléatoires, quotas recherches / achats par heure et 24 h (cumulés avec ceux de SnipeFC27), pauses de session, arrêt + verrou 12 h sur statut captcha / limite (426, 429, 458, 460, 494, 512, 521), rechargement auto sur session expirée, attente si SnipeFC27 tourne. Liste de transferts pleine (100) : attente des ventes. Après un captcha, pas de reprise automatique : le résoudre à la main puis relancer.

## Limites connues

- Le niveau atteint n'est pas lu dans le jeu : la progression est une estimation (score saisi + `gradingScore` des cartes achetées, sans bonus de tags). Le niveau réel se vérifie dans la Galerie.
- Unicité par definitionId (resourceId EA) : une même carte n'est achetée qu'une fois.
- L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
