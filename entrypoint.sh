#!/bin/bash
set -e

echo "[SYSTEM] Démarrage du conteneur WVDL..."

# 1. Création des dossiers cibles s'ils n'existent pas encore
mkdir -p /app/db /app/cache /app/logs /app/cookies

# 2. Correction des permissions globale sur l'application (le conteneur démarre en 'root' spécialement pour faire ça)
echo "[SYSTEM] Ajustement des permissions pour ytuser (UID 1000)..."
chown -R ytuser:ytgroup /app

# 3. S'assure que le HOME de ytuser existe et lui appartient (nécessaire pour le
#    cache de Deno utilisé par yt-dlp lors de la résolution du challenge JS nsig).
mkdir -p /home/ytuser/.cache
chown -R ytuser:ytgroup /home/ytuser

# 4. Abandon des droits root et exécution de la commande finale (gunicorn).
#    gosu ne réinitialise pas HOME : on le force explicitement sur /home/ytuser,
#    sinon deno tente d'écrire dans /root/.cache (interdit) et yt-dlp croit
#    qu'aucun runtime JS n'est disponible.
echo "[SYSTEM] Lancement du serveur web..."
exec gosu ytuser env HOME=/home/ytuser "$@"
