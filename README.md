# Extensions FC 27 Web App

- `SnipeFC27/` : autobuyer existant (achat sous le prix, revente avec marge).
- `AlbumFC27/` : complète un set de la **Galerie** FC 27 (joueurs du set via fut.gg, achat puis revente immédiate juste sous le marché).

## AlbumFC27 : utilisation

1. Chrome > `chrome://extensions` > Mode développeur > Charger l'extension non empaquetée > dossier `AlbumFC27` (recharger l'extension après mise à jour).
2. Ouvrir la Web App FC 27. Le panneau s'affiche à gauche.
3. **Choisir le set** : bouton « Choisir un set sur fut.gg ». Sur fut.gg, ouvrir le set voulu (Galerie > club, championnat, nation…) puis cliquer le bouton vert « Envoyer à AlbumFC27 ». Les joueurs du set (identifiant EA, prix fut.gg) arrivent dans le panneau de la Web App.
   En secours : « Un club, joueurs lus sur le marché ». Choisir championnat puis club (ou « Club de ma dernière recherche marché »), puis « Chercher les joueurs du club » : seules les cartes en vente apparaissent, et le scan consomme des recherches.
4. **Choisir les joueurs** : cocher ceux à acheter. Le prix max est prérempli (prix fut.gg ou plus bas vu + 10 %, réglable) et modifiable par joueur. Les joueurs sans prix connu demandent un prix max saisi à la main.
5. **Valider** : pour chaque joueur coché, recherche par carte (defId) jusqu'au prix max, achat de l'annonce la moins chère, puis remise en vente immédiate (1 h) : un palier sous la moins chère des autres annonces vues (50 crédits sous 1 000, 100 de 1 000 à 10 000, etc.), ou au prix d'achat s'il n'y en a pas d'autre. Statut affiché sur chaque ligne.

## Fonctionnement

- **Suivi des ventes** (lancé automatiquement après les achats, ou bouton « Suivre les ventes ») : toutes les 5 min (réglable), encaisse les ventes ; chaque joueur acheté resté invendu est remis un palier sous la moins chère des annonces concurrentes (≤ son prix actuel), ou au même prix si personne n'est en dessous. Plancher optionnel en % du prix d'achat (0 par défaut = aucun). S'arrête quand tout est vendu, reprend après un rechargement. Une annonce active ne peut pas être modifiée : le réajustement se fait à l'expiration (1 h).
- **Compteurs** : crédits perdus sur les ventes faites (prix d'achat − montant net après taxe, un gain apparaît comme tel), perte estimée si les joueurs encore en vente partent au prix affiché, taxe EA payée. Remise à zéro dans Réglages.
- Joueurs déjà dans la Galerie : repérés par le champ `isCollected` des réponses EA (scan, ou recherche au moment de l'achat) et par l'historique des achats de l'extension. Ignorés.
- Prix de revente : seules les annonces ≤ prix max sont vues (recherche d'achat) ; s'il n'y en a aucune autre, le prix d'achat est déjà le plus bas. Coût = taxe EA de 5 % par vente, plus l'écart si la revente est sous le prix d'achat.
- Joueur introuvable au prix max après N recherches (3 par défaut) : marqué « introuvable », on passe au suivant.
- Reprise automatique des achats en attente après un rechargement de la Web App (session expirée).

## Garde-fous

Repris de SnipeFC27 : délais aléatoires, quotas recherches / achats par heure et 24 h (cumulés avec ceux de SnipeFC27), arrêt + verrou 12 h sur statut captcha / limite (426, 429, 458, 460, 494, 512, 521) ou 8 achats ratés d'affilée, rechargement auto sur session expirée, refus de démarrer si SnipeFC27 tourne. Liste de transferts pleine (100) : attente des ventes.

## Limites connues

- Lecture de fut.gg : basée sur la page affichée (liens joueurs `/players/…/27-<defId>`, prix à côté de l'icône crédit). Un changement de mise en page fut.gg peut casser l'import.
- Liste championnats / clubs (secours) : lue dans les données internes de la Web App, sans API documentée. Si elle reste vide, passer par « Club de ma dernière recherche marché » et envoyer le résultat de « Copier diagnostic clubs ».
- Que l'achat suffise à compter le joueur dans le set (sans l'ajouter à la main dans la Galerie) n'est pas vérifié : à contrôler dans la Galerie sur les premiers achats.
- L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
