#!/bin/bash

# Détection de l'environnement : Docker ou Natif
if [ -d "/opt/ytvenv" ]; then
    echo "[SYSTEM] Environnement Docker détecté."
    VENV_PIP="/opt/ytvenv/bin/pip"
else
    echo "[SYSTEM] Environnement Natif (Debian) détecté."
    source /home/virtua/applications/WVDL/.venv/bin/activate
    VENV_PIP="pip"
fi

echo "[SYSTEM] Lancement de la mise à jour..."
$VENV_PIP install --upgrade --no-cache-dir yt-dlp
echo "[SYSTEM] Mise à jour terminée avec succès."
