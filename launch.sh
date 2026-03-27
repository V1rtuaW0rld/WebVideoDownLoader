#!/bin/bash
cd /home/virtua/applications/WVDL

if [ ! -d ".venv" ]; then
  echo "❌ Environnement virtuel manquant. Lance ./setup.sh d'abord."
  exit 1
fi

source .venv/bin/activate
exec python3 main.py

