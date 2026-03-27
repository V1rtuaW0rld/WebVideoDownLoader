#!/bin/bash
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install --upgrade flask yt-dlp
