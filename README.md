# Extensions FC 27 Web App

- `SnipeFC27/` : autobuyer existant (achat sous le prix, revente avec marge).
- `AlbumFC27/` : complète un set de la **Galerie** FC 27 (joueurs du set via fut.gg, achat puis revente immédiate juste sous le marché).

## AlbumFC27 : utilisation

1. Chrome > `chrome://extensions` > Mode développeur > Charger l'extension non empaquetée > dossier `AlbumFC27` (« Recharger » après mise à jour).
2. Ouvrir la Web App FC 27. Le panneau s'affiche à gauche (onglets Sets, Ventes, Journal, Réglages).
3. **Ajouter des sets** : « + Set depuis fut.gg », ouvrir un set de la Galerie sur fut.gg, cliquer le bouton vert « Envoyer à AlbumFC27 ». Répéter pour chaque set : ils s'empilent dans le panneau. Renvoyer un set déjà présent le met à jour.
   En secours : « + Club via le marché » (championnat → club, ou club de la dernière recherche marché) puis « Scanner ce club » : seules les cartes en vente apparaissent.
4. **Cocher les joueurs** : par joueur, par set (case de l'en-tête) ou tout ce qui est filtré (recherche par nom, rareté). Le prix max est prérempli (prix de référence + 10 %) et modifiable. Un joueur présent dans plusieurs sets n'est acheté qu'une fois.
5. **Coût projeté** (bas du panneau) : joueurs cochés, crédits engagés (prix de référence), coût projeté = fourchette entre la taxe seule (revente au prix d'achat) et la taxe plus un palier (revente sous la concurrence). Alerte si les crédits disponibles ne couvrent pas tout.
6. **Acheter et revendre** : pour chaque joueur, achat de l'annonce la moins chère sous le prix max, puis remise en vente immédiate un palier sous la moins chère des autres annonces vues (50 crédits sous 1 000, 100 de 1 000 à 10 000, etc.), ou au prix d'achat s'il n'y en a pas d'autre. Barre de progression et statut par joueur.

## Fonctionnement

- **Suivi des ventes** (onglet Ventes, lancé automatiquement après les achats) : toutes les 5 min (réglable), encaisse les ventes ; chaque joueur acheté resté invendu est remis un palier sous la moins chère des annonces concurrentes, ou au même prix si personne n'est en dessous. Plancher optionnel en % du prix d'achat (0 = aucun). Le réajustement se fait à l'expiration (1 h), une annonce active ne pouvant pas être modifiée.
- **Compteurs** (onglet Ventes) : crédits perdus sur les ventes faites (prix d'achat − net après taxe), perte estimée sur les joueurs encore en vente, achetés / revendus, taxe EA. Remise à zéro dans Réglages.
- **Verrou automatique** : sur statut captcha / limite EA (426, 429, 458, 460, 494, 512, 521) ou 8 achats ratés d'affilée, pause de 30 min (réglable), doublée à chaque nouveau blocage dans les 24 h (plafond 12 h), puis reprise automatique de la tâche interrompue (achats ou suivi des ventes). Bannière avec heure de reprise et bouton « Lever ». Si EA affiche un captcha, le résoudre dans la Web App pendant la pause. Réglage à 0 = ancien comportement (arrêt et verrou 12 h).
- Joueurs déjà dans la Galerie : repérés par `isCollected` (réponses EA) et l'historique d'achats de l'extension, ignorés.
- Reprise automatique des achats en attente et du suivi des ventes après un rechargement de la Web App (session expirée).

## Garde-fous

Délais aléatoires, quotas recherches / achats par heure et 24 h (cumulés avec SnipeFC27), refus de démarrer si SnipeFC27 tourne, liste de transferts pleine (100) : attente des ventes.

## Limites connues

- Import fut.gg basé sur la page affichée (liens `/players/…/27-<defId>`, prix à côté de l'icône crédit) : un changement de mise en page fut.gg peut le casser.
- Liste championnats / clubs (secours) lue dans les données internes de la Web App, sans API documentée. Si vide : « Club de ma dernière recherche » et envoyer « Copier diagnostic clubs ».
- Que l'achat suffise à compter le joueur dans le set (sans ajout manuel dans la Galerie) n'est pas vérifié.
- Reprendre automatiquement après un captcha non résolu relance un blocage (d'où la pause doublée). L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
