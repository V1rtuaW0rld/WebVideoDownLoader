#!/bin/bash

# Chemin absolu du dossier du projet (/home/virtua/yt-dlp)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
OUTPUT_DIR="${WVDL_OUTPUT_DIR:-/mnt/nas/video/yt-dlp}"

# Horodatage
timestamp=$(date +"%Y-%m-%d_%H-%M-%S")

# Créer les dossiers si nécessaire
mkdir -p "$OUTPUT_DIR"
mkdir -p "$LOG_DIR"

# Vérifier les permissions du dossier logs
chmod -R 755 "$LOG_DIR" 2>/dev/null || echo "⚠️ Erreur : Impossible de modifier les permissions de $LOG_DIR"

# Log avec ID de tâche
task_id="$2"  # Deuxième argument : ID de la tâche
log_file="$LOG_DIR/download_${task_id}_${timestamp}.log"

# Vérifier si le fichier de log est accessible
touch "$log_file" 2>/dev/null || {
  echo "⚠️ Erreur : Impossible de créer le fichier de log $log_file"
  exit 1
}

# URL à télécharger
URL="$1"

if [[ -z "$URL" ]]; then
  echo "Erreur : aucun lien fourni. Usage : $0 <URL> <TASK_ID>" | tee -a "$log_file"
  exit 1
fi

# Calcul de la longueur maximale du titre
output_length=${#OUTPUT_DIR}  # Longueur de /mnt/nas/video/yt-dlp/ (environ 20)
max_title_length=$((250 - output_length - 4))  # 250 - longueur de OUTPUT_DIR - 4 (pour .ext)

# Vérifier que max_title_length est positif
if [ "$max_title_length" -le 0 ]; then
  echo "⚠️ Erreur : La longueur de OUTPUT_DIR ($output_length) est trop longue, max_title_length = $max_title_length" | tee -a "$log_file"
  exit 1
fi

# Commande yt-dlp avec troncature dynamique
yt_dlp_bin="$(which yt-dlp)"

if [[ -z "$yt_dlp_bin" ]]; then
  echo "Erreur : yt-dlp non trouvé dans le PATH" | tee -a "$log_file"
  exit 1
fi


# Afficher la commande exacte pour déboguer
echo "Exécution de la commande : $yt_dlp_bin --restrict-filenames --progress --socket-timeout 60 --retries 20 --fragment-retries 10 --concurrent-fragments 16 -f \"bv*+ba/bestvideo+bestaudio/best\" -o \"$OUTPUT_DIR/%(title).${max_title_length}s.%(ext)s\" \"$URL\" 2>&1 | tee -a \"$log_file\"" | tee -a "$log_file"

# S'assure que aria2 est utilisé s'il est installé
# --concurrent-fragments 16 : On multiplie par 4 le nombre de connexions simultanées
# --file-access-provider builtin : Accélère l'écriture sur certains systèmes
# --buffer-size 1M : Augmente la mémoire tampon pour les gros débits

# Injection du cookie si l'appli en a fourni un pour ce service (via l'env)
COOKIE_ARGS=()
if [[ -n "$WVDL_COOKIE_FILE" && -f "$WVDL_COOKIE_FILE" ]]; then
  COOKIE_ARGS=(--cookies "$WVDL_COOKIE_FILE")
  echo "🔑 Utilisation du cookie : $WVDL_COOKIE_FILE" | tee -a "$log_file"
fi

# Injection des headers navigateur (User-Agent, Referer, Origin)
HEADER_ARGS=()
if [[ -n "$WVDL_USER_AGENT" ]]; then
  HEADER_ARGS+=(--user-agent "$WVDL_USER_AGENT")
fi
if [[ -n "$WVDL_REFERER" ]]; then
  HEADER_ARGS+=(--referer "$WVDL_REFERER" --add-header "Referer: $WVDL_REFERER")
fi
if [[ -n "$WVDL_ORIGIN" ]]; then
  HEADER_ARGS+=(--add-header "Origin: $WVDL_ORIGIN")
fi

"$yt_dlp_bin" \
  --no-playlist \
  --restrict-filenames \
  --no-check-certificates \
  --remote-components ejs:github \
  "${COOKIE_ARGS[@]}" \
  "${HEADER_ARGS[@]}" \
  --progress \
  --socket-timeout 60 \
  --retries 20 \
  --fragment-retries 10 \
  --concurrent-fragments 16 \
  -f "bv*+ba/bestvideo+bestaudio/best" \
  -o "$OUTPUT_DIR/%(title).${max_title_length}s.%(ext)s" \
  "$URL" 2>&1 | tee -a "$log_file"  # Pas de \ avant la dernière ligne
