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
2. **Lancer le sniper**. Prix automatiques : achat un palier sous la moins chère du marché, baissé jusqu'au profit visé (2 % du prix, 150 minimum, ou profit min réglé), revente 1 h jamais sous le prix d'achat taxe comprise.
3. **Alterner les cibles** (remplace le mode nuit) : change de cible toutes les 450 à 900 recherches.

Fonctionnement continu, toujours actif : le sniper attend au lieu de s'arrêter (crédits insuffisants, liste de transferts pleine, quota anti-ban, cible sans prix rentable), reprend après rechargement de la Web App (session expirée, connexion automatique si la session EA est ouverte), après une tâche Galerie et après une pause. Pendant ses pauses : ventes encaissées, non-assignés rangés, snipes invendus remis en vente.

Hésitations : 8 % des recherches, +0,5 à 1,5 s (au lieu de +1 à 4 s).

## Galerie (AlbumFC27)

- Sets de la Galerie fut.gg importés à l'ouverture (au plus toutes les 6 h), ou un par un avec le bouton « Envoyer à FC27 Trader » sur fut.gg. Statut collecté lu chez EA.
- Sélectionner les cartes manquantes, puis au choix :
  - **🎯 Sniper** : les cartes deviennent des cibles du sniper (alternance activée, sniper lancé). Achat sous le prix du marché, revente avec profit : la Galerie se remplit en gagnant des crédits, plus lentement. Une carte obtenue est retirée des cibles.
  - **Acheter maintenant** : achat direct au prix du marché (méthode FST : 4e annonce la moins chère, écart max en paliers), puis revente au prix d'achat, avec marge ou club. Rapide, coût = taxe EA 5 %. Le sniper est suspendu pendant les achats puis reprend seul. En fin de lot, les cartes non achetées peuvent être envoyées au sniper.

## Ventes

Un seul **Relister les invendus** (sniper arrêté) : remet chaque invendu un palier sous la moins chère du marché, jamais sous le prix d'achat (taxe comprise pour un snipe, prix payé pour une carte Galerie). « Cartes Galerie en vente » : recalé sur la vraie liste de transferts à chaque lecture (ouverture de la Web App, pauses du sniper, liste ouverte dans la Web App, bouton « ↻ Actualiser ») ; une carte absente n'est plus suivie. Suivi du sniper (profit réel, par heure, en attente, snipes, recherches, temps, rendement sur les cartes vendues, taxe EA payée, délai de vente moyen, profit du jour), coût réel de la Galerie, dernières ventes.

Suivi détaillé du sniper (bouton « Réinitialiser » commun) :

- **Sessions** : une session couvre le fonctionnement continu du sniper, rechargements de la Web App et tâches Galerie compris ; un arrêt manuel la clôt, plus de 30 min d'interruption en ouvre une nouvelle. Par session : durée, recherches, snipes / ratés, profit réel (rattaché à la session d'achat, même si la vente arrive plus tard), en attente, profit / h ; détail des cibles au survol. 30 dernières sessions conservées. L'onglet Sniper et la popup affichent la session en cours.
- **Par joueur** : snipes / ratés, ventes, profit réel, profit moyen par vente, délai moyen de vente, cartes en attente ; recherches ciblées, investi et meilleure vente au survol. Tri par profit, snipes ou activité récente, export CSV (presse-papiers).
- **Par jour** : 14 derniers jours, durée, recherches, snipes, ventes, profit réel.

## Garde-fous (communs à toutes les tâches)

- Une seule tâche EA à la fois.
- Limites anti-ban (Prudent 600 recherches / h, 3 000 / 24 h, 120 achats / h, 600 / 24 h ; ou Stevie), délais et pauses réglables dans Réglages.
- Captcha ou limite EA (426, 429, 458, 460, 494, 512, 521, marché vide sans filtre) : pause de 30 à 60 min puis reprise automatique, doublée si ça se répète dans les 24 h (4 h max), notification système. Un captcha affiché doit être résolu à la main dans la Web App.

## Limites connues

- Testé sur une Web App simulée uniquement (moteurs, suspension et reprise, ventes, relist, pause captcha).
- Import fut.gg dépendant de la mise en page de fut.gg.
- L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
