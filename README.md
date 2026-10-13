# Extensions FC 27 Web App

- `SnipeFC27/` : autobuyer existant (achat sous le prix, revente avec marge).
- `AlbumFC27/` : complète la **Galerie** FC 27 (l'album). Achète chaque joueur manquant des ensembles choisis puis le remet en vente au prix d'achat. Coût visé : la taxe EA de 5 % par carte vendue.

## Principe AlbumFC27

Une carte compte dans la Galerie dès qu'elle entre dans le club (non-assignés compris) et reste comptée après la revente (règle EA : un objet passé par le club compte même vendu, hors prêts). L'extension :

1. parcourt le marché pour chaque ensemble, par paliers de prix croissants (200, 300, 400, 500, 700, 1000… jusqu'au prix max), plusieurs pages par palier ;
2. achète au Achat immédiat chaque joueur (definitionId) pas encore collecté, du moins cher au plus cher ;
3. le place dans la liste de transferts au même prix (Achat immédiat = prix payé, enchère de départ un palier en dessous, 1 h) ;
4. toutes les 3 min : encaisse les ventes, remet les invendus en vente au même prix (ou un palier plus bas après N invendus, réglable) ;
5. quand tous les ensembles sont balayés, refait un passage après X min pour les nouvelles annonces.

Coût réel par carte vendue : `prix × 5 %`. Une carte à 200 coûte 10 crédits, une 84 à 1 500 coûte 75. Le capital est immobilisé tant que les cartes ne sont pas revendues. Majoration revente à 5,3 % pour viser une opération à coût nul (ventes plus lentes).

## Installation

Chrome > `chrome://extensions` > Mode développeur > Charger l'extension non empaquetée > dossier `AlbumFC27`. Ouvrir la Web App, le panneau s'affiche à gauche (SnipeFC27 est à droite).

## Utilisation

1. Dans la Web App : Transferts > Marché, régler les filtres d'un ensemble de la Galerie (club, championnat, nation, rareté, qualité), lancer la recherche.
2. Panneau AlbumFC27 > Ajouter un ensemble > **Capturer la recherche du marché** : les filtres sont repris tels quels.
3. Nommer, saisir le prix max par carte (et éventuellement note min/max), Ajouter. Répéter pour chaque ensemble.
4. Réglages avancés > **Scanner le club** pour ignorer les joueurs déjà possédés (option « Ignorer les joueurs déjà possédés »).
5. Démarrer.

Export / import des ensembles en JSON dans les réglages avancés. Les critères restent éditables à la main, par exemple `{"league":16,"level":"gold"}`.

## Garde-fous

Repris de SnipeFC27 : délais aléatoires, quotas recherches / achats par heure et 24 h (cumulés avec ceux de SnipeFC27), pauses de session, arrêt + verrou 12 h sur statut captcha / limite (426, 429, 458, 460, 494, 512, 521), rechargement auto sur session expirée, refus de démarrer si SnipeFC27 tourne. Liste de transferts pleine (100) : attente des ventes.

## Limites connues

- Le score affiché est une **estimation** du score de base (bronze 20, argent 35, or 75 = 90 … 90 = 14 000, valeurs communautaires), sans bonus de rareté ni tags. Le grade réel se lit dans la Galerie.
- Unicité supposée par definitionId : une même carte n'est achetée qu'une fois.
- Les joueurs déjà dans la Galerie mais plus dans le club ne sont pas détectés. Le bouton « Copier réponses Galerie » copie les réponses réseau de la Galerie captées par la Web App pour permettre une lecture directe dans une version suivante.
- L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
