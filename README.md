# Torrent PWA – Client BitTorrent client-side

Première version d’une Progressive Web App inspirée de Transmission, purement client-side (WebTorrent), sans serveur backend ni base de données.

## Fonctionnalités

- Ajout par **Info Hash**, lien **Magnet** ou fichier **.torrent**
- Liste des torrents avec progression, vitesses, ETA et nombre de pairs
- Vue détail (fichiers, infos, pairs)
- Sélection de fichiers
- Pause / Reprendre / Supprimer
- Historique local (IndexedDB)
- Installable en PWA (Add to Home Screen)
- Mode sombre, compatible iOS / iPadOS Safari
- **Pas de streaming vidéo**

## Limitations importantes (surtout iOS)

- Fonctionne uniquement avec des pairs **WebTorrent / WebRTC**.
- La majorité des seeders classiques (Transmission, qBittorrent, etc.) ne sont **pas** visibles.
- Safari suspend l’application en arrière-plan → les téléchargements longs sont fragiles.
- Le stockage (IndexedDB) peut être purgé après ~7 jours d’inactivité.

## Comment l’utiliser

### Option simple (recommandée)

1. Déposez le dossier `pwa-torrent` sur un hébergement **statique gratuit** :
   - GitHub Pages
   - Cloudflare Pages
   - Netlify / Vercel
2. Ouvrez l’URL dans Safari sur iPhone ou iPad.
3. Partage → **Sur l’écran d’accueil**.
4. L’application s’ouvre comme une app native.

### En local (développement)

```bash
cd pwa-torrent
python3 -m http.server 8080
```

Puis ouvrez `http://localhost:8080` dans un navigateur.

> Sur iOS, l’ouverture directe d’un fichier `index.html` local est limitée. Un petit serveur HTTP ou un hébergement statique est préférable.

## Structure

```
pwa-torrent/
├── index.html
├── manifest.json
├── sw.js
├── css/styles.css
├── js/app.js
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

## Stack

- WebTorrent (CDN)
- Vanilla JS
- IndexedDB
- Service Worker + Web App Manifest

## Licence

Code fourni à titre de prototype / démonstration.
