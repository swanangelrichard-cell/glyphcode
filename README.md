# MemeMot (React + TypeScript + CSS)

Prototype web du jeu du mot mystere, avec mode solo, duel contre IA et duel en ligne.

## Regles (solo)

- Le jeu choisit un mot secret selon le mode :
  - `Normal` : mot de 5 lettres, 8 essais
  - `Expert` : mot de 5 lettres, 6 essais, sans indices visuels
  - `Long` : mot de 7 lettres, 8 essais
- Le mot propose doit exister dans le dictionnaire integre pour la bonne longueur.
- A chaque essai valide, on voit combien de lettres sont a la bonne place.
- Statistiques sauvegardees automatiquement (localStorage).
- Feedback visuel :
  - animation legere sur une ligne validee
  - secousse du champ si mot invalide

## Duel en ligne (2 joueurs)

- Chaque joueur choisit son mot secret.
- Les tours alternent automatiquement.
- Le premier joueur qui trouve le mot adverse gagne.
- Reconnexion automatique :
  - si refresh ou perte reseau, la session est reprise automatiquement
  - delai de grace configurable (par defaut `90s`)
- Chat rapide dans la salle :
  - messages libres
  - boutons de messages rapides

## Duel contre IA

- Tu choisis ton mot secret.
- L'IA choisit aussi un mot secret dans le dictionnaire.
- Vous jouez tour par tour.
- L'IA deduit progressivement ton mot selon les retours `X/Y` lettres bien placees.
- Le premier qui trouve le mot adverse gagne.

## Dictionnaire

- Source : package `an-array-of-french-words`
- Traitement : normalisation en majuscules A-Z, suppression accents/signes, filtrage par longueur
- Taille actuelle :
  - 5 lettres : 5916 mots
  - 6 lettres : 13944 mots
  - 7 lettres : 25577 mots

Regeneration :

- `npm run dict:generate`

## Stack

- React + TypeScript + CSS
- Socket.IO (temps reel)
- Express (serveur duel)
- Vite
- Capacitor Android

## Lancement local

1. Installer les dependances :
   - `npm install`
2. Lancer le serveur duel (terminal 1) :
   - `npm run server:dev`
3. Lancer le frontend (terminal 2) :
   - `npm run dev`
4. Ouvrir l'URL Vite (souvent `http://localhost:5173`).

Variables utiles :

- Front :
  - `VITE_DUEL_SERVER_URL` (ex: `http://localhost:3001`)
- Serveur :
  - `PORT` (defaut `3001`)
  - `CORS_ORIGIN` (origines autorisees, separees par virgule)
  - `RECONNECT_GRACE_MS` (defaut `90000`)

Exemple `CORS_ORIGIN` :

- `http://localhost:5173,https://ton-front.exemple.com`
- Pour Android (APK Capacitor), ajoute aussi `http://localhost` :
  - `http://localhost:5173,https://ton-front.exemple.com,http://localhost`

## Deploiement serveur en ligne

Objectif : jouer a distance reelle hors localhost.

### Option A - Render

Le repo contient `render.yaml`.

1. Push le repo sur GitHub.
2. Sur Render : `New` -> `Blueprint`.
3. Selectionner le repo (Render lit `render.yaml`).
4. Verifier / adapter les variables :
   - `CORS_ORIGIN=https://ton-front.exemple.com`
   - `RECONNECT_GRACE_MS=90000`
5. Deployer.
6. Recuperer l'URL publique du serveur, exemple :
   - `https://mememot-duel-server.onrender.com`
7. Configurer le frontend avec :
   - `VITE_DUEL_SERVER_URL=https://mememot-duel-server.onrender.com`

Test rapide :

- `GET /health` doit retourner `{ "ok": true, ... }`

### Option B - Railway

Le repo contient `railway.json`.

1. Push le repo sur GitHub.
2. Sur Railway : `New Project` -> `Deploy from GitHub repo`.
3. Railway detecte `npm start` (ou lit `railway.json`).
4. Ajouter les variables :
   - `CORS_ORIGIN=https://ton-front.exemple.com`
   - `RECONNECT_GRACE_MS=90000`
5. Deployer puis recuperer l'URL publique.
6. Configurer le frontend :
   - `VITE_DUEL_SERVER_URL=https://ton-serveur-railway.up.railway.app`

## Deploiement frontend sur Netlify (configuration exacte)

Le repo contient `netlify.toml` avec :

- build command : `npm run build`
- publish directory : `dist`
- rewrite SPA : `/* -> /index.html (200)`

Etapes :

1. Push du repo sur GitHub.
2. Sur Netlify : `Add new project` -> `Import an existing project` -> GitHub -> choisir le repo.
3. Verification build settings (si Netlify les demande) :
   - Base directory : vide (racine)
   - Build command : `npm run build`
   - Publish directory : `dist`
4. Dans Netlify, ajouter la variable d'environnement frontend :
   - `VITE_DUEL_SERVER_URL=https://URL_DE_TON_SERVEUR_DUEL`
5. Lancer le deploy Netlify.
6. Recuperer l'URL publique Netlify, ex :
   - `https://glyphcode.netlify.app`
7. Mettre a jour le serveur duel (Render/Railway) avec `CORS_ORIGIN` :
   - `CORS_ORIGIN=https://glyphcode.netlify.app,http://localhost`
   - si domaine custom : `CORS_ORIGIN=https://glyphcode.netlify.app,https://jeu.tondomaine.com,http://localhost`
8. Redeployer le serveur duel apres changement de `CORS_ORIGIN`.
9. Tester :
   - front Netlify charge
   - connexion duel OK
   - chat et reconnexion OK

## Build production

- `npm run build`
- `npm run preview`

## Version Android (APK)

Pour jouer en ligne a 2 sur Android, l'app doit pointer vers un serveur duel public (`https://...`).

1. Configurer `VITE_DUEL_SERVER_URL` en production (fichier `.env.production`) :
   - `VITE_DUEL_SERVER_URL=https://URL_DE_TON_SERVEUR_DUEL`
2. Build web :
   - `npm run build`
3. Initialiser Android (une seule fois) :
   - `npm run android:add`
4. Synchroniser :
   - `npm run android:sync`
5. Generer l'APK debug :
   - `npm run android:build:debug`

APK genere :

- `android/app/build/outputs/apk/debug/app-debug.apk`
- copie pratique : `MemeMot-debug.apk` a la racine du projet

## Fichiers importants

- `src/SoloGame.tsx` : mode solo
- `src/OnlineDuel.tsx` : mode duel en ligne (reconnexion + chat)
- `src/App.tsx` : switch des modes
- `src/App.css` : interface + animations
- `src/data/frenchWordsByLength.json` : dictionnaire complet (5, 6, 7)
- `src/wordBank.ts` : mots secrets + dictionnaire
- `server/index.js` : serveur Socket.IO / Express
- `render.yaml` / `railway.json` : deploiement serveur cloud
- `capacitor.config.ts` + dossier `android/` : build Android


