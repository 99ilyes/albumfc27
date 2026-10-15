# FC27 Trader

Extension Chrome unique pour la Web App FC 27 : fusion de SnipeFC27 (0.6.2) et AlbumFC27 (3.3). Elle remplace les deux anciennes extensions : désinstalle-les avant de charger celle-ci (les réglages, cibles, sets et statistiques sont repris automatiquement, même stockage).

## Installation

`chrome://extensions` > Mode développeur > Charger l'extension non empaquetée > dossier `FC27Trader` (« Recharger » après mise à jour).

## Interface

- **Bouton flottant** (bas à gauche) : état en direct, bouton ▶ / ■ pour lancer ou arrêter le sniper, clic pour ouvrir le panneau.
- **Panneau** : onglets Sniper, Galerie, Ventes, Journal, Réglages. Un bandeau unique montre la tâche en cours avec un seul bouton **Arrêter** (et « Lever la pause » pendant une pause anti-captcha).
- **Popup** de l'extension : état, crédits, profit, lancer / arrêter le sniper, alternance, relister, ouvrir le panneau.

## Sniper (moteur SnipeFC27)

1. Onglet Sniper > **Cibles** : chercher un joueur, « + Filtre de la Web App », ou ajouter des cartes manquantes depuis la Galerie (🎯).
2. **Sélectionner** (rond) un joueur ou un groupe : c'est ce que le sniper cherche.
3. **Lancer le sniper**. Prix automatiques : achat un palier sous la moins chère du marché, baissé jusqu'au profit visé (2 % du prix, 150 minimum, ou profit min réglé), revente 1 h jamais sous le prix d'achat taxe comprise. Prix revérifiés toutes les N recherches, toutes les 15 min et après un snipe.

### Groupes : plusieurs joueurs en une recherche

1. **Scanner les prix** (bouton du bloc Cibles) : moins chère du marché, prix d'achat, club, ligue, nation et rareté de chaque joueur en prix automatiques, sans lancer le sniper. Prix de moins de 15 min repris au lancement.
2. **Cocher** les joueurs à grouper. La barre sous la liste dit s'ils sont compatibles : critère commun (club, ligue, nation ou rareté spéciale) et prix compatibles (prix d'achat le plus haut sous l'annonce la moins chère de chacun, sinon leurs annonces normales rempliraient la page). 6 joueurs max.
3. **Créer le groupe** : nouvelle entrée de la liste, sélectionnée. Lancer le sniper.

Le groupe fait une seule recherche sur les critères communs et une fourchette de prix ; seules ses cartes sont achetées, chacune sous son propre prix d'achat. Les résultats EA sont triés par fin de vente : les annonces fraîches (celles à sniper) arrivent en dernier et restent visibles tant que la page (21 annonces) n'est pas pleine. Les cartes hors cibles ne gênent donc pas tant que la page ne sature pas. Au lancement, prix min calibré à 60, 75, 85, 90 puis 95 % du prix d'achat le plus bas, retenu si la recherche renvoie au plus 10 annonces. En cours de route : page saturée (18 annonces), ou chargée (plus de 14) 3 fois d'affilée, recalibrage plus haut ; calibrage impossible ou prix devenus incompatibles, groupe mis en attente 10 min. En cas d'échec, le journal nomme les cartes qui encombrent la fourchette (nombre d'annonces, prix). Un joueur retiré est enlevé de ses groupes (groupe supprimé s'il lui reste moins de 2 joueurs).

### Alterner (onglet Sniper)

Désactivé : seule la sélection est cherchée. Activé : toutes les cibles et groupes l'un après l'autre (les joueurs d'un groupe sont cherchés via le groupe), N recherches chacun (Réglages > Alternance, 1 par défaut). Chaque cible garde sa fenêtre de cache EA (31 s) : plus d'attente de résultats frais. Cible sans prix rentable ignorée 10 min, cible trop chère pour les crédits sautée.

Fonctionnement continu, toujours actif : le sniper attend au lieu de s'arrêter (crédits insuffisants, liste de transferts pleine, quota anti-ban, cible sans prix rentable), reprend après rechargement de la Web App (session expirée, connexion automatique si la session EA est ouverte), après une tâche Galerie et après une pause. Pendant ses pauses : ventes encaissées, non-assignés rangés, snipes invendus remis en vente.

Hésitations : 8 % des recherches, +0,5 à 1,5 s (au lieu de +1 à 4 s).

## Galerie (AlbumFC27)

- Sets de la Galerie fut.gg importés à l'ouverture (au plus toutes les 6 h), ou un par un avec le bouton « Envoyer à FC27 Trader » sur fut.gg. Statut collecté lu chez EA.
- Sélectionner les cartes manquantes, puis au choix :
  - **🎯 Sniper** : les cartes deviennent des cibles du sniper (alternance activée, sniper lancé). Achat sous le prix du marché, revente avec profit : la Galerie se remplit en gagnant des crédits, plus lentement. Une carte obtenue est retirée des cibles.
  - **Acheter maintenant** : achat direct au prix du marché (méthode FST : 4e annonce la moins chère, écart max en paliers), puis revente au prix d'achat, avec marge ou club. Rapide, coût = taxe EA 5 %. Le sniper est suspendu pendant les achats puis reprend seul. En fin de lot, les cartes non achetées peuvent être envoyées au sniper.

## Ventes

Un seul **Relister les invendus** (sniper arrêté) : remet chaque invendu un palier sous la moins chère du marché, jamais sous le prix d'achat (taxe comprise pour un snipe, prix payé pour une carte Galerie). « Cartes Galerie en vente » : recalé sur la vraie liste de transferts à chaque lecture (ouverture de la Web App, pauses du sniper, liste ouverte dans la Web App, bouton « ↻ Actualiser ») ; une carte absente n'est plus suivie. Suivi du sniper (profit réel, par heure, en attente, snipes, recherches, temps), coût réel de la Galerie, dernières ventes.

## Garde-fous (communs à toutes les tâches)

- Une seule tâche EA à la fois.
- Limites anti-ban (Prudent 600 recherches / h, 3 000 / 24 h, 120 achats / h, 600 / 24 h ; ou Stevie), délais et pauses réglables dans Réglages.
- Captcha ou limite EA (426, 429, 458, 460, 494, 512, 521, marché vide sans filtre) : pause de 30 à 60 min puis reprise automatique, doublée si ça se répète dans les 24 h (4 h max), notification système. Un captcha affiché doit être résolu à la main dans la Web App.

## Limites connues

- Testé sur une Web App simulée uniquement (moteurs, suspension et reprise, ventes, relist, pause captcha).
- Import fut.gg dépendant de la mise en page de fut.gg.
- Groupes : club, ligue, nation et rareté lus sur les cartes de la Web App (`teamId`, `leagueId`, `nationId`, `rareflag`) et critères de recherche `club`, `league`, `nation`, `rarities`, `level`, non vérifiés sur la vraie Web App (avertissement dans le journal si ces attributs manquent).
- L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
