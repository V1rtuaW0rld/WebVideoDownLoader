from flask import Flask, render_template, request, Response
import subprocess
import shlex
import threading
import queue
import os
import re
import uuid
import json
from bdd import db
import cookies_manager
import time
import sqlite3
import urllib.request
from werkzeug.middleware.proxy_fix import ProxyFix
app = Flask(__name__, static_folder='static', template_folder='templates')
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_host=1)

# Suivi des processus actifs pour redirection/arrêt
active_processes = {}
stopped_tasks = set()

class MessageAnnouncer:
    def __init__(self):
        self.listeners = []

    def listen(self):
        q = queue.Queue(maxsize=1000)
        self.listeners.append(q)
        return q

    def announce(self, msg):
        for i in reversed(range(len(self.listeners))):
            try:
                self.listeners[i].put_nowait(msg)
            except queue.Full:
                del self.listeners[i]

announcer = MessageAnnouncer()

# Motifs d'erreur yt-dlp signalant un cookie manquant/expiré (auth requise)
_AUTH_ERROR_RE = re.compile(
    r"(need to log in|login required|requires? (?:a )?login|sign in to|"
    r"use --cookies|only available (?:to|for) (?:registered|logged)|"
    r"this (?:video|content|post) is private|rate.?limit reach)",
    re.IGNORECASE,
)


def get_stream_headers(url):
    """Dérive un User-Agent navigateur et des headers Referer/Origin appropriés pour contourner les blocages 403."""
    user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    origin = ""
    referer = ""
    try:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()
        parts = hostname.split('.')
        if len(parts) >= 2:
            if len(parts) >= 3 and parts[-2] in ('co', 'com', 'org', 'net', 'edu', 'gov'):
                root_domain = '.'.join(parts[-3:])
            else:
                root_domain = '.'.join(parts[-2:])
        else:
            root_domain = hostname
        
        scheme = parsed.scheme or "https"
        if root_domain:
            origin = f"{scheme}://{root_domain}"
            referer = f"{scheme}://{root_domain}/"
    except Exception:
        pass
    return user_agent, referer, origin


def build_json_cmd(url):
    """Construit la commande --dump-json en injectant les cookies et en-têtes navigateur."""
    cookie_file = cookies_manager.cookie_file_for_url(url)
    cookie_opt = f"--cookies {shlex.quote(cookie_file)} " if cookie_file else ""
    user_agent, referer, origin = get_stream_headers(url)
    headers_opt = f"--user-agent {shlex.quote(user_agent)} "
    if referer:
        headers_opt += f"--add-header {shlex.quote(f'Referer: {referer}')} "
    if origin:
        headers_opt += f"--add-header {shlex.quote(f'Origin: {origin}')} "

    return (
        f"yt-dlp --no-playlist --restrict-filenames --no-check-certificates --remote-components ejs:github "
        f"{headers_opt}{cookie_opt}--dump-json {shlex.quote(url)}"
    )


def build_script_env(url):
    """Env pour les scripts de téléchargement : transmet le fichier cookie éventuel et les headers HTTP."""
    env = os.environ.copy()
    cookie_file = cookies_manager.cookie_file_for_url(url)
    if cookie_file:
        env["WVDL_COOKIE_FILE"] = cookie_file
    else:
        env.pop("WVDL_COOKIE_FILE", None)

    user_agent, referer, origin = get_stream_headers(url)
    env["WVDL_USER_AGENT"] = user_agent
    if referer:
        env["WVDL_REFERER"] = referer
    else:
        env.pop("WVDL_REFERER", None)
    if origin:
        env["WVDL_ORIGIN"] = origin
    else:
        env.pop("WVDL_ORIGIN", None)
    return env


def handle_extraction_error(url, task_id, stderr):
    """Annonce l'erreur d'extraction, avec un message dédié si auth/cookie requis."""
    if _AUTH_ERROR_RE.search(stderr or ""):
        cookies_manager.mark_status_for_url(url, expired=True)
        announcer.announce(
            f"[{task_id}] 🔑 Cookie requis ou expiré pour ce service. "
            f"Ouvre la modale « clé » (en haut à droite) pour (re)coller un cookie valide."
        )
    announcer.announce(f"[{task_id}] ❌ Erreur ou JSON vide : {stderr}")


def run_yt_dlp(url, task_id):
    print(f"Démarrage de la tâche {task_id} pour {url} (vidéo)")
    try:
        json_cmd = build_json_cmd(url)
        print(f"Exécution de la commande JSON : {json_cmd}")
        result = subprocess.run(shlex.split(json_cmd), capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
        if result.returncode == 0 and result.stdout.strip():
            try:
                video_info = json.loads(result.stdout.strip())
                title = video_info.get('title', 'Titre inconnu')
                thumbnail = video_info.get('thumbnail', '')
                duration_string = video_info.get('duration_string', 'N/A')
                filesize_approx = video_info.get('filesize_approx', None)
                resolution = video_info.get('resolution', 'N/A')
                filename = f"{title}.{video_info.get('ext', 'mp4')}"

                if filesize_approx:
                    if filesize_approx >= 1_000_000_000:
                        filesize_approx = f"{filesize_approx / 1_000_000_000:.2f} Go"
                    elif filesize_approx >= 1_000_000:
                        filesize_approx = f"{filesize_approx / 1_000_000:.2f} Mo"
                    else:
                        filesize_approx = f"{filesize_approx / 1_000:.2f} Ko"
                else:
                    filesize_approx = 'N/A'

                cookies_manager.mark_status_for_url(url, expired=False)
                db.add_task(task_id, title, thumbnail, duration_string, filesize_approx, resolution, filename, url, 'video')
                task = db.get_task_by_id(task_id)
                announcer.announce(f"[{task_id}] VideoInfo: {json.dumps({'task_id': task_id, 'date': task[0], 'title': title, 'thumbnail': thumbnail, 'duration_string': duration_string, 'filesize_approx': filesize_approx, 'resolution': resolution, 'filename': filename, 'progress': 0, 'status': task[10], 'type': 'video'})}")
            except json.JSONDecodeError as e:
                announcer.announce(f"[{task_id}] ❌ Erreur lors du parsing JSON : {str(e)}")
                return
        else:
            handle_extraction_error(url, task_id, result.stderr)
            return
    except subprocess.TimeoutExpired as e:
        announcer.announce(f"[{task_id}] ❌ Timeout lors de la récupération des informations")
        return
    except Exception as e:
        announcer.announce(f"[{task_id}] ❌ Erreur inattendue : {str(e)}")
        return

    script_path = os.path.join("scripts", "run_yt_dlp.sh")
    if not os.path.isfile(script_path):
        announcer.announce(f"[{task_id}] ❌ Erreur : Script {script_path} introuvable")
        return
    command = f"bash {script_path} {shlex.quote(url)} {shlex.quote(task_id)}"
    try:
        process = subprocess.Popen(
            shlex.split(command),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
            env=build_script_env(url)
        )
        active_processes[task_id] = process
        progress_re = re.compile(r'\[download\]\s+(\d+\.\d+)%')
        dest_re = re.compile(r'\[download\] Destination: (.*)')
        merger_re = re.compile(r'\[Merger\] Merging formats into "(.*)"')
        final_filename = None

        for line in iter(process.stdout.readline, ''):
            line = line.strip()
            if line:
                if task_id in stopped_tasks:
                    continue  # Ne plus annoncer les logs si stoppé par l'utilisateur
                
                match = progress_re.search(line)
                if match:
                    percentage = float(match.group(1))
                    db.update_progress(task_id, percentage)
                    announcer.announce(f"[{task_id}] Progress: {percentage}")

                dest_match = dest_re.search(line)
                if dest_match:
                    final_filename = dest_match.group(1)

                merger_match = merger_re.search(line)
                if merger_match:
                    final_filename = merger_match.group(1)

                announcer.announce(f"[{task_id}] {line}")
        process.wait()
        
        # Nettoyage
        is_manual_stop = task_id in stopped_tasks
        if is_manual_stop:
            stopped_tasks.discard(task_id)
        
        if task_id in active_processes:
            del active_processes[task_id]

        if process.returncode == 0:
            db.update_progress(task_id, 100)
            if final_filename:
                db.update_real_filename(task_id, final_filename)
            announcer.announce(f"[{task_id}] ✅ Téléchargement terminé !")
            task = db.get_task_by_id(task_id)
            announcer.announce(f"[{task_id}] VideoInfo: {json.dumps({'task_id': task_id, 'date': task[0], 'title': task[2], 'thumbnail': task[3], 'duration_string': task[4], 'filesize_approx': task[5], 'resolution': task[6], 'filename': task[7], 'progress': task[8], 'status': task[10], 'type': task[11]})}")
        else:
            db.update_status(task_id, '0')
            task = db.get_task_by_id(task_id)
            announcer.announce(f"[{task_id}] VideoInfo: {json.dumps({'task_id': task_id, 'date': task[0], 'title': task[2], 'thumbnail': task[3], 'duration_string': task[4], 'filesize_approx': task[5], 'resolution': task[6], 'filename': task[7], 'progress': task[8], 'status': task[10], 'type': task[11]})}")
            if not is_manual_stop:
                announcer.announce(f"[{task_id}] ❌ Erreur : code {process.returncode}")
    except FileNotFoundError as e:
        announcer.announce(f"[{task_id}] ❌ Erreur : Commande bash ou script introuvable : {str(e)}")
    except Exception as e:
        announcer.announce(f"[{task_id}] ❌ Erreur exécution : {str(e)}")

def run_yt_dlp_audio(url, task_id):
    print(f"Démarrage de la tâche {task_id} pour {url} (audio)")
    # Récupération des métadatas en premier
    try:
        json_cmd = build_json_cmd(url)
        print(f"Exécution de la commande JSON : {json_cmd}")
        result = subprocess.run(shlex.split(json_cmd), capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
        if result.returncode == 0 and result.stdout.strip():
            try:
                video_info = json.loads(result.stdout.strip())
                title = video_info.get('title', 'Titre inconnu')
                thumbnail = video_info.get('thumbnail', '')  # Récupérer la miniature
                duration_string = video_info.get('duration_string', 'N/A')
                filesize_approx = video_info.get('filesize_approx', None)
                resolution = 'N/A'  # Pas de résolution pour audio
                filename = f"{title}.mp3"

                if filesize_approx:
                    if filesize_approx >= 1_000_000_000:
                        filesize_approx = f"{filesize_approx / 1_000_000_000:.2f} Go"
                    elif filesize_approx >= 1_000_000:
                        filesize_approx = f"{filesize_approx / 1_000_000:.2f} Mo"
                    else:
                        filesize_approx = f"{filesize_approx / 1_000:.2f} Ko"
                else:
                    filesize_approx = 'N/A'

                # Stocker les métadatas dans la BDD, même sans téléchargement
                cookies_manager.mark_status_for_url(url, expired=False)
                db.add_task(task_id, title, thumbnail, duration_string, filesize_approx, resolution, filename, url, 'audio')
                task = db.get_task_by_id(task_id)
                announcer.announce(f"[{task_id}] VideoInfo: {json.dumps({'task_id': task_id, 'date': task[0], 'title': title, 'thumbnail': thumbnail, 'duration_string': duration_string, 'filesize_approx': filesize_approx, 'resolution': resolution, 'filename': filename, 'progress': 0, 'status': task[10], 'type': 'audio'})}")
            except json.JSONDecodeError as e:
                announcer.announce(f"[{task_id}] ❌ Erreur lors du parsing JSON : {str(e)}")
                return
        else:
            handle_extraction_error(url, task_id, result.stderr)
            return
    except subprocess.TimeoutExpired as e:
        announcer.announce(f"[{task_id}] ❌ Timeout lors de la récupération des informations")
        return
    except Exception as e:
        announcer.announce(f"[{task_id}] ❌ Erreur inattendue : {str(e)}")
        return

    # Lancement du téléchargement
    script_path = os.path.join("scripts", "run_yt_dlp_audio.sh")
    if not os.path.isfile(script_path):
        announcer.announce(f"[{task_id}] ❌ Erreur : Script {script_path} introuvable")
        return
    command = f"bash {script_path} {shlex.quote(url)} {shlex.quote(task_id)}"
    try:
        process = subprocess.Popen(
            shlex.split(command),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
            env=build_script_env(url)
        )
        active_processes[task_id] = process
        progress_re = re.compile(r'\[download\]\s+(\d+\.\d+)%')
        dest_re = re.compile(r'\[download\] Destination: (.*)')
        merger_re = re.compile(r'\[Merger\] Merging formats into "(.*)"')
        final_filename = None

        for line in iter(process.stdout.readline, ''):
            line = line.strip()
            if line:
                if task_id in stopped_tasks:
                    continue  # Ne plus annoncer les logs si stoppé par l'utilisateur

                match = progress_re.search(line)
                if match:
                    percentage = float(match.group(1))
                    db.update_progress(task_id, percentage)
                    announcer.announce(f"[{task_id}] Progress: {percentage}")

                dest_match = dest_re.search(line)
                if dest_match:
                    final_filename = dest_match.group(1)

                merger_match = merger_re.search(line)
                if merger_match:
                    final_filename = merger_match.group(1)

                announcer.announce(f"[{task_id}] {line}")
        process.wait()
        
        # Nettoyage
        is_manual_stop = task_id in stopped_tasks
        if is_manual_stop:
            stopped_tasks.discard(task_id)

        if task_id in active_processes:
            del active_processes[task_id]

        if process.returncode == 0:
            db.update_progress(task_id, 100)
            if final_filename:
                db.update_real_filename(task_id, final_filename)
            announcer.announce(f"[{task_id}] ✅ Téléchargement terminé !")
            task = db.get_task_by_id(task_id)
            announcer.announce(f"[{task_id}] VideoInfo: {json.dumps({'task_id': task_id, 'date': task[0], 'title': task[2], 'thumbnail': task[3], 'duration_string': task[4], 'filesize_approx': task[5], 'resolution': task[6], 'filename': task[7], 'progress': task[8], 'status': task[10], 'type': task[11]})}")
        else:
            db.update_status(task_id, '0')
            task = db.get_task_by_id(task_id)
            announcer.announce(f"[{task_id}] VideoInfo: {json.dumps({'task_id': task_id, 'date': task[0], 'title': task[2], 'thumbnail': task[3], 'duration_string': task[4], 'filesize_approx': task[5], 'resolution': task[6], 'filename': task[7], 'progress': task[8], 'status': task[10], 'type': task[11]})}")
            if not is_manual_stop:
                announcer.announce(f"[{task_id}] ❌ Erreur : code {process.returncode} - {line}")
    except FileNotFoundError as e:
        announcer.announce(f"[{task_id}] ❌ Erreur : Commande bash ou script introuvable : {str(e)}")
    except Exception as e:
        announcer.announce(f"[{task_id}] ❌ Erreur exécution : {str(e)}")

def get_yt_dlp_version():
    """Récupère la version actuelle de yt-dlp."""
    try:
        result = subprocess.run(["yt-dlp", "--version"], capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except Exception as e:
        print(f"Erreur lors de la récupération de la version de yt-dlp : {e}")
        return "Inconnue"

def get_latest_yt_dlp_version():
    """Récupère la dernière version stable de yt-dlp via l'API GitHub."""
    url = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
    try:
        # User-Agent est requis par GitHub API
        req = urllib.request.Request(url, headers={'User-Agent': 'WVDL-App'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            # La version est généralement dans le champ 'tag_name'
            return data.get('tag_name', 'Inconnue')
    except Exception as e:
        print(f"Erreur lors de la récupération de la dernière version de yt-dlp : {e}")
        return "Inconnue"

def run_update_yt_dlp():
    """Exécute le script de mise à jour et envoie les logs au flux SSE."""
    announcer.announce("[SYSTEM] 🔄 Démarrage de la mise à jour de yt-dlp...")
    script_path = os.path.join(os.path.dirname(__file__), "update_yt_dlp.sh")
    if not os.path.isfile(script_path):
        announcer.announce("[SYSTEM] ❌ Erreur : Script update_yt_dlp.sh introuvable.")
        return

    try:
        process = subprocess.Popen(
            ["bash", script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        for line in iter(process.stdout.readline, ''):
            line = line.strip()
            if line:
                announcer.announce(f"[SYSTEM] {line}")
        process.wait()
        if process.returncode == 0:
            new_version = get_yt_dlp_version()
            announcer.announce(f"[SYSTEM] ✅ Mise à jour terminée ! Nouvelle version : {new_version}")
        else:
            announcer.announce(f"[SYSTEM] ❌ Échec de la mise à jour (code {process.returncode}).")
    except Exception as e:
        announcer.announce(f"[SYSTEM] ❌ Erreur lors de l'exécution de la mise à jour : {str(e)}")

@app.route('/api/yt-dlp-status')
def yt_dlp_status():
    current = get_yt_dlp_version()
    latest = get_latest_yt_dlp_version()
    update_available = False
    if current != "Inconnue" and latest != "Inconnue":
        # Comparaison simple (les versions sont YYYY.MM.DD)
        update_available = latest > current
    return json.dumps({
        "current": current,
        "latest": latest,
        "update_available": update_available
    }), 200, {'Content-Type': 'application/json'}

@app.route('/api/yt-dlp-update', methods=['POST'])
def yt_dlp_update():
    threading.Thread(target=run_update_yt_dlp, daemon=True).start()
    return "🚀 Mise à jour lancée en arrière-plan...", 200

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/cookies', methods=['GET'])
def cookies_list():
    return json.dumps(cookies_manager.list_status()), 200, {'Content-Type': 'application/json'}

@app.route('/api/cookies/<provider_id>', methods=['POST'])
def cookies_save(provider_id):
    content = request.form.get('content', '')
    ok, msg = cookies_manager.save_credential(provider_id, content)
    return msg, (200 if ok else 400)

@app.route('/api/cookies/<provider_id>', methods=['DELETE'])
def cookies_delete(provider_id):
    ok, msg = cookies_manager.delete_credential(provider_id)
    return msg, (200 if ok else 400)

@app.route('/download', methods=['POST'])
def download():
    url = request.form.get('url')
    if not url:
        return "❌ URL manquante !", 400
    urls = [u.strip() for u in url.split(',') if u.strip()]
    for url in urls:
        task_id = str(uuid.uuid4())
        threading.Thread(target=run_yt_dlp, args=(url, task_id), daemon=True).start()
        print(f"Tâche {task_id} lancée pour {url} (vidéo)")
    return "🚀 Téléchargement(s) vidéo démarré(s)...", 200

@app.route('/download-audio', methods=['POST'])
def download_audio():
    url = request.form.get('url')
    if not url:
        return "❌ URL manquante !", 400
    # Vérification basique de l'URL
    if not url.startswith(('http://', 'https://')):
        return "❌ URL invalide !", 400
    urls = [u.strip() for u in url.split(',') if u.strip()]
    for url in urls:
        task_id = str(uuid.uuid4())
        threading.Thread(target=run_yt_dlp_audio, args=(url, task_id), daemon=True).start()
        print(f"Tâche {task_id} lancée pour {url} (audio)")
    return "🚀 Téléchargement(s) audio démarré(s)...", 200

@app.route('/resume', methods=['POST'])
def resume():
    task_id = request.form.get('task_id')
    if not task_id:
        return "❌ task_id manquant !", 400
    task = db.get_task_by_id(task_id)
    if not task or not task[9]:  # task[9] est original_url
        return f"❌ Tâche {task_id} non trouvée ou URL absente", 404
    original_url = task[9]
    task_type = task[11]  # task[11] est type (video ou audio)
    
    # Mettre à jour status avec un nouveau timestamp
    import time
    new_timestamp = str(int(time.time()))  # Convertir en string pour TEXT
    db.update_status(task_id, new_timestamp)
    
    # Lancer la reprise selon le type
    if task_type == 'video':
        threading.Thread(target=run_yt_dlp, args=(original_url, task_id), daemon=True).start()
        return f"🚀 Reprise de la tâche {task_id} (vidéo) avec {original_url}", 200
    elif task_type == 'audio':
        threading.Thread(target=run_yt_dlp_audio, args=(original_url, task_id), daemon=True).start()
        return f"🚀 Reprise de la tâche {task_id} (audio) avec {original_url}", 200
    else:
        return f"❌ Type de tâche {task_type} inconnu pour {task_id}", 400

@app.route('/stream')
def stream():
    page = int(request.args.get('page', 1))
    per_page = 5
    def generate():
        tasks, total_pages, total = db.get_all_tasks_paginated(page, per_page)
        if not tasks:
            print("Aucune tâche trouvée pour la page", page)
        print(f"Page {page} - Tâches chargées: {len(tasks)}, Total pages: {total_pages}, Total items: {total}")
        print(f"Ordre des tâches initiales: {[task[0] for task in tasks]}")
        initial_data = {
            "type": "InitialData",
            "tasks": [{"date": task[0], "task_id": task[1], "title": task[2], "thumbnail": task[3], "duration_string": task[4], "filesize_approx": task[5], "resolution": task[6], "filename": task[7], "progress": task[8], "status": task[10], "type": task[11]} for task in tasks],
            "pagination": {
                "current_page": page,
                "total_pages": total_pages,
                "total_items": total,
                "per_page": per_page
            }
        }
        yield f"data: {json.dumps(initial_data)}\n\n"
        
        # Subscribe to announcer AFTER sending initial data
        q = announcer.listen()
        while True:
            try:
                line = q.get(timeout=1.0)
                if line:
                    yield f"data: {line}\n\n"
            except queue.Empty:
                yield ": keepalive\n\n"
    return Response(generate(), mimetype='text/event-stream', headers={'Cache-Control': 'no-cache', 'Connection': 'keep-alive'})

def kill_process_by_task_id(task_id):
    """Tente de tuer le processus via le dictionnaire actif OU via le système (fallback)."""
    # 1. Tentative via le dictionnaire en mémoire
    if task_id in active_processes:
        try:
            active_processes[task_id].terminate()
            active_processes[task_id].wait(timeout=2)
            del active_processes[task_id]
            print(f"DEBUG: Process killed via memory tracking for {task_id}")
            return True
        except Exception as e:
            print(f"DEBUG: Error killing via memory: {e}")

    # 2. Fallback via pgrep/pkill (cherche le script bash qui contient le task_id)
    try:
        # On cherche les processus 'bash' qui ont le task_id dans leurs arguments
        cmd = f"pgrep -f {shlex.quote(task_id)}"
        result = subprocess.run(shlex.split(cmd), capture_output=True, text=True)
        if result.returncode == 0:
            pids = result.stdout.strip().split('\n')
            for pid in pids:
                if pid:
                    subprocess.run(["kill", "-15", pid])
                    print(f"DEBUG: Process {pid} killed via system fallback for {task_id}")
            return True
    except Exception as e:
        print(f"DEBUG: Error killing via system fallback: {e}")
    
    return False

@app.route('/delete-task', methods=['POST'])
def delete_task_route():
    task_id = request.form.get('task_id')
    delete_file = request.form.get('delete_file') == 'true'

    if not task_id:
        return "Missing task_id", 400

    kill_process_by_task_id(task_id)

    task = db.get_task_by_id(task_id)
    if not task:
        return "Task not found", 404

    if delete_file:
        real_filename = task[12] if len(task) > 12 else None
        if real_filename and os.path.exists(real_filename):
            try:
                os.remove(real_filename)
                print(f"Deleted file: {real_filename}")
            except Exception as e:
                print(f"Erreur lors de la suppression du fichier {real_filename}: {e}")

    db.delete_task(task_id)
    return "OK", 200

@app.route('/stop-task', methods=['POST'])
def stop_task():
    task_id = request.form.get('task_id')
    if not task_id:
        return "❌ task_id manquant !", 400
    
    # Marquer comme stoppé IMMÉDIATEMENT pour le thread
    stopped_tasks.add(task_id)
    
    if kill_process_by_task_id(task_id):
        db.update_status(task_id, '0')
        announcer.announce(f"[{task_id}] 🛑 Téléchargement arrêté par l'utilisateur.")
        task = db.get_task_by_id(task_id)
        if task:
            announcer.announce(f"[{task_id}] VideoInfo: {json.dumps({'task_id': task_id, 'date': task[0], 'title': task[2], 'thumbnail': task[3], 'duration_string': task[4], 'filesize_approx': task[5], 'resolution': task[6], 'filename': task[7], 'progress': task[8], 'status': '0', 'type': task[11]})}")
        return "OK", 200
    
    # Si le processus n'a pas pu être tué (déjà fini ?), on retire le flag
    stopped_tasks.discard(task_id)
    return "Tâche non active", 404

if __name__ == '__main__':
    print("Démarrage du serveur Flask...")
    sentinelle_path = os.path.join("scripts", "sentinelle.sh")
    if os.path.isfile(sentinelle_path):
        print(f"⚠️ Script {sentinelle_path} introuvable. sentinelle.sh ne sera pas lancé.")
    app.run(host="0.0.0.0", port=5011, debug=True)
