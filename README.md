# 🎬 WebVideoDownLoader (WVDL)

<p align="center">
  <img src="static/images/logo.png" alt="WebVideoDownLoader Logo" width="120">
</p>

<p align="center">
  <strong>Le centre de téléchargement multimédia personnel, moderne et ultra-rapide.</strong><br>
  Propulsé par Python, Docker et le formidable moteur <strong>yt-dlp</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11-blue?logo=python" alt="Python 3.11">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker" alt="Docker Ready">
  <img src="https://img.shields.io/badge/yt--dlp-Latest-red?logo=youtube" alt="yt-dlp">
  <img src="https://img.shields.io/badge/Design-Dark%20Mode%202026-6366f1" alt="Design 2026">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License MIT">
</p>

---

## ✨ Points Forts & Fonctionnalités

* 🚀 **Téléchargement Universel** : Compatible avec plus de 1000+ sites (YouTube, Instagram, TikTok, Facebook, Twitter/X, Dailymotion, Soundcloud, Twitch, etc.).
* ⚡ **Vitesse Maximale** : Téléchargement accéléré via **16 fragments simultanés** et optimisation multi-flux.
* 🎵 **Vidéo HD ou Audio MP3 en 1 clic** : Choisissez d'extraire la vidéo dans sa meilleure résolution disponible ou de convertir automatiquement le flux audio en MP3.
* 🌙 **Interface Moderne 2026 (Dark / Light)** :
  * Thème sombre immersif par défaut et bascule instantanée en mode clair.
  * **Affichage 100% Plein Écran** sans bandes vides : tire pleinement parti des moniteurs Full HD, 2K, 4K tout en restant parfaitement responsive sur mobile et tablette.
  * Bouton rapide **« Coller »** depuis le presse-papier.
  * Miniatures 16:9 avec zoom fluide et badges de résolution élégants (`1080p`, `4K`, `WEBM`, etc.).
* 📊 **Suivi en Temps Réel (SSE)** : Progression dynamique sans rechargement de page, barres de progression animées, estimation du poids et statut en direct.
* 🛑 **Contrôle & Gestion Complète** :
  * Possibilité d'**arrêter** et de **reprendre** (`resume`) un téléchargement interrompu.
  * Menu d'actions à 3 points (⋮) pour supprimer de l'historique ou effacer le fichier directement du disque.
* 🔑 **Gestionnaire de Cookies Intégré** : Interface dédiée pour importer vos cookies (format Netscape) pour les plateformes nécessitant une authentification (Instagram, comptes privés, etc.).
* 🛡️ **Challenge YouTube JS résolu** : Embarque nativement le runtime **Deno** et les composants EJS pour contourner les protections `nsig` de YouTube sans friction.
* 💻 **Console de Logs Rétractable** : Console style DevTools / VS Code intégrée en bas de page pour déboguer facilement les commandes en direct.

---

<img width="1909" height="1059" alt="image" src="https://github.com/user-attachments/assets/067078ad-5b19-4f80-9e86-045110d58e4d" />


## 🚀 Démarrage Rapide avec Docker Compose

### 1. Configuration (`.env`)

Créez ou adaptez votre fichier `.env` :

```env
# Port d'accès à l'interface web (défaut : 5000)
WVDL_PORT=5000
```

Dans [docker-compose.yml](docker-compose.yml), adaptez si besoin le chemin vers votre dossier de stockage ou votre NAS :

```yaml
services:
  wvdl:
    container_name: wvdl
    build: .
    image: wvdl:latest
    ports:
      - "${WVDL_PORT:-5000}:5000"
    volumes:
      - /mnt/nas/video/yt-dlp:/app/downloads:rw   # Répertoire cible des vidéos
      - ./app_db:/app/db:rw                     # Base de données SQLite
      - ./cache:/app/cache:rw
      - ./logs:/app/logs:rw                     # Logs de téléchargement
      - ./cookies:/app/cookies:rw               # Stockage des cookies de session
    restart: unless-stopped
```

### 2. Lancement

```bash
docker-compose up -d
```

Rendez-vous ensuite sur `http://localhost:5000` (ou sur l'IP/domaine de votre serveur) !

---

## 💡 L'Astuce Indispensable : Avoir Toujours le Dernier yt-dlp

Les plateformes comme YouTube mettent régulièrement à jour leurs lecteurs vidéo et leurs algorithmes pour bloquer les extracteurs. Il est donc crucial d'avoir un moteur `yt-dlp` constamment à jour.

### 👉 Reconstruire l'image sans cache (recommandé lors des mises à jour majeures) :

Pour forcer Docker à re-télécharger la toute dernière version de `yt-dlp` directement depuis la branche principale GitHub :

```bash
docker-compose build --no-cache && docker-compose up -d
```

### 👉 Mise à jour à chaud depuis l'interface web :

L'application intègre un vérificateur de version en temps réel dans la barre de navigation. Dès qu'une nouvelle version est détectée sur GitHub, un bouton **« Mettre à jour »** apparaît pour actualiser le moteur en arrière-plan sans même redémarrer le conteneur !

---

## 🙏 Remerciements & Crédits

Ce projet s'appuie sur des outils exceptionnels de la communauté open-source :

* **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** : Un immense merci à toute l'équipe et aux contributeurs de **yt-dlp**, qui maintiennent sans relâche le moteur de téléchargement le plus puissant, fiable et complet au monde.
* **[Deno](https://deno.land/)** : Runtime JavaScript moderne utilisé pour exécuter les challenges d'extraction YouTube.
* **[FFmpeg](https://ffmpeg.org/)** : Le couteau suisse multimédia pour la conversion audio MP3 et le multiplexage vidéo/audio.
* **[Bootstrap 5](https://getbootstrap.com/)** & **[Bootstrap Icons](https://icons.getbootstrap.com/)** : Pour l'ergonomie et le design épuré de l'interface.
