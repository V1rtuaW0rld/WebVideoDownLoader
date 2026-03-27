#!/bin/bash

DB_PATH="./data/bdd.sqlite"
CHECK_INTERVAL=20
TIMEOUT=60
LOG_FILE="./scripts/sentinelle.log"

while true; do
  NOW_EPOCH=$(date +%s)
  echo "[$(date)] Vérification en cours (NOW=$NOW_EPOCH)" >> "$LOG_FILE"

  # Requête SQL : récupérer les tâches dont le status est un timestamp Unix trop vieux
  sqlite3 "$DB_PATH" <<SQL > interrupted_tasks.txt
.headers off
.mode csv
SELECT task_id, status FROM tasks
WHERE status NOT IN ('0', '1')
  AND status GLOB '[0-9]*'
  AND CAST(status AS INTEGER) <= $((NOW_EPOCH - TIMEOUT));
SQL

  # Log brut du contenu
  echo "[$(date)] Tâches candidates :" >> "$LOG_FILE"
  cat interrupted_tasks.txt >> "$LOG_FILE"

  if [ -s interrupted_tasks.txt ]; then
while IFS=',' read -r task_id status; do
  status=$(echo "$status" | tr -d '\r\n')
  if [[ "$status" =~ ^[0-9]+$ ]]; then
    age=$((NOW_EPOCH - status))
    if [ "$age" -ge "$TIMEOUT" ]; then
      sqlite3 "$DB_PATH" <<SQL
UPDATE tasks SET status = '0' WHERE task_id = '$task_id';
SQL
      echo "[$(date)] Tâche $task_id réinitialisée (age=$age s)" >> "$LOG_FILE"
    else
      echo "[$(date)] Tâche $task_id ignorée (age=$age s < $TIMEOUT)" >> "$LOG_FILE"
    fi
  else
    echo "[$(date)] Tâche $task_id ignorée (status non numérique → '$status')" >> "$LOG_FILE"
  fi
done < interrupted_tasks.txt

  else
    echo "[$(date)] Aucune tâche à réinitialiser" >> "$LOG_FILE"
  fi

  rm -f interrupted_tasks.txt
  sleep "$CHECK_INTERVAL"
done
