"""
Gestion des credentials (cookies) par fournisseur.

Objectif : permettre de coller un cookies.txt (ou un token simple) pour un
service donné (Instagram, et d'autres à venir), puis injecter automatiquement
le bon fichier de cookies dans yt-dlp en fonction de l'URL téléchargée.

Le contenu des cookies est stocké en clair dans un volume dédié (WVDL_COOKIES_DIR).
La sécurité d'accès est déléguée à un proxy d'authentification placé devant l'appli.
"""

import os
import json
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse

# --- Registre des fournisseurs -------------------------------------------------
# Pour ajouter un service : ajouter une entrée ici. Le reste (matching URL,
# stockage, UI via /api/cookies) s'adapte automatiquement.
#
#   input_type == "cookies" : on colle le contenu d'un cookies.txt (Netscape).
#   input_type == "token"   : on colle une valeur unique ; on fabrique un
#                             cookies.txt minimal via cookie_template.
PROVIDERS = [
    {
        "id": "instagram",
        "label": "Instagram",
        "domains": ["instagram.com", "instagr.am", "cdninstagram.com"],
        "input_type": "cookies",
        "help": "Exporte un cookies.txt depuis ton navigateur connecté à Instagram "
                "(extension « Get cookies.txt LOCALLY ») et colle son contenu ici.",
    },
    # Exemple de futur fournisseur en mode token (désactivé, gabarit) :
    # {
    #     "id": "deezer",
    #     "label": "Deezer (ARL)",
    #     "domains": ["deezer.com"],
    #     "input_type": "token",
    #     "cookie_name": "arl",
    #     "cookie_domain": ".deezer.com",
    #     "help": "Colle la valeur du cookie ARL de ton compte Deezer.",
    # },
]

_NETSCAPE_HEADER = "# Netscape HTTP Cookie File\n"

COOKIES_DIR = os.environ.get("WVDL_COOKIES_DIR", "/app/cookies")
_STATE_FILE = os.path.join(COOKIES_DIR, "state.json")
_lock = threading.Lock()


# --- Helpers internes ----------------------------------------------------------

def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _provider(provider_id):
    for p in PROVIDERS:
        if p["id"] == provider_id:
            return p
    return None


def _cookie_path(provider_id):
    return os.path.join(COOKIES_DIR, f"{provider_id}.txt")


def _ensure_dir():
    os.makedirs(COOKIES_DIR, exist_ok=True)


def _load_state():
    try:
        with open(_STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_state(state):
    _ensure_dir()
    tmp = _STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, _STATE_FILE)


def _provider_for_url(url):
    """Retourne le provider dont un domaine correspond à l'hôte de l'URL."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return None
    if not host:
        return None
    for p in PROVIDERS:
        for dom in p["domains"]:
            if host == dom or host.endswith("." + dom):
                return p
    return None


# --- API publique --------------------------------------------------------------

def cookie_file_for_url(url):
    """
    Retourne le chemin du fichier de cookies à passer à yt-dlp pour cette URL,
    ou None si aucun provider ne correspond / aucun cookie enregistré.
    """
    p = _provider_for_url(url)
    if not p:
        return None
    path = _cookie_path(p["id"])
    return path if os.path.isfile(path) else None


def mark_status_for_url(url, expired):
    """Met à jour le statut (expiré / valide) du provider correspondant à l'URL."""
    p = _provider_for_url(url)
    if not p:
        return
    with _lock:
        state = _load_state()
        entry = state.get(p["id"], {})
        # On ne "revalide" un cookie que s'il existe encore.
        if expired or os.path.isfile(_cookie_path(p["id"])):
            entry["expired"] = bool(expired)
            state[p["id"]] = entry
            _save_state(state)


def save_credential(provider_id, content):
    """
    Enregistre le credential collé pour un provider.
    - input_type "cookies" : contenu = cookies.txt (on préfixe l'entête Netscape si absent).
    - input_type "token"   : contenu = valeur unique -> cookies.txt minimal.
    Retourne (ok: bool, message: str).
    """
    p = _provider(provider_id)
    if not p:
        return False, "Fournisseur inconnu."
    content = (content or "").strip()
    if not content:
        return False, "Contenu vide."

    if p["input_type"] == "token":
        # Fabrique un cookies.txt minimal à partir d'une valeur unique.
        domain = p.get("cookie_domain", "." + p["domains"][0])
        name = p.get("cookie_name", "token")
        # domain  flag  path  secure  expiry  name  value
        line = f"{domain}\tTRUE\t/\tTRUE\t0\t{name}\t{content}\n"
        data = _NETSCAPE_HEADER + line
    else:
        data = content
        if not data.lstrip().startswith("# ") and "HTTP Cookie File" not in data.splitlines()[0]:
            data = _NETSCAPE_HEADER + data
        if not data.endswith("\n"):
            data += "\n"

    _ensure_dir()
    path = _cookie_path(provider_id)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)

    with _lock:
        state = _load_state()
        state[provider_id] = {"updated_at": _now_iso(), "expired": False}
        _save_state(state)
    return True, "Credential enregistré."


def delete_credential(provider_id):
    p = _provider(provider_id)
    if not p:
        return False, "Fournisseur inconnu."
    path = _cookie_path(provider_id)
    if os.path.isfile(path):
        os.remove(path)
    with _lock:
        state = _load_state()
        state.pop(provider_id, None)
        _save_state(state)
    return True, "Credential supprimé."


def list_status():
    """
    Retourne la liste des providers avec leur statut, pour l'UI.
    On ne renvoie JAMAIS le contenu du cookie (write-only côté client).
    status : "absent" | "ok" | "expired"
    """
    state = _load_state()
    out = []
    for p in PROVIDERS:
        has_file = os.path.isfile(_cookie_path(p["id"]))
        entry = state.get(p["id"], {})
        if not has_file:
            status = "absent"
        elif entry.get("expired"):
            status = "expired"
        else:
            status = "ok"
        out.append({
            "id": p["id"],
            "label": p["label"],
            "input_type": p["input_type"],
            "help": p.get("help", ""),
            "status": status,
            "updated_at": entry.get("updated_at"),
        })
    return out
