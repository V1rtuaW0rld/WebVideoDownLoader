// Gestion de la modale des cookies / credentials par service.
(function () {
    "use strict";

    const STATUS = {
        absent:  { label: "Aucun cookie",  badge: "bg-secondary", dot: "bg-secondary" },
        ok:      { label: "Configuré",     badge: "bg-success",   dot: "bg-success"   },
        expired: { label: "Expiré",        badge: "bg-danger",    dot: "bg-danger"    },
    };

    const container = document.getElementById("cookies-providers");
    const headerBadge = document.getElementById("cookies-badge");

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
        ));
    }

    // Met à jour la pastille sur l'icône clé du header :
    //   rouge si au moins un service est expiré, vert si au moins un configuré, sinon caché.
    function updateHeaderBadge(providers) {
        if (!headerBadge) return;
        const anyExpired = providers.some(p => p.status === "expired");
        const anyOk = providers.some(p => p.status === "ok");
        headerBadge.className =
            "position-absolute top-0 start-100 translate-middle p-1 border border-light rounded-circle " +
            (anyExpired ? "bg-danger" : anyOk ? "bg-success" : "bg-secondary");
        headerBadge.style.display = (anyExpired || anyOk) ? "" : "none";
    }

    function providerCard(p) {
        const st = STATUS[p.status] || STATUS.absent;
        const updated = p.updated_at
            ? `<small class="text-muted">MàJ : ${escapeHtml(p.updated_at.replace("T", " ").replace("+00:00", " UTC"))}</small>`
            : "";
        const placeholder = p.input_type === "token"
            ? "Colle ici la valeur du token…"
            : "Colle ici le contenu de ton cookies.txt (format Netscape)…";
        return `
        <div class="card mb-3" data-provider="${escapeHtml(p.id)}">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <h6 class="mb-0">${escapeHtml(p.label)}
                        <span class="badge ${st.badge} ms-2">${st.label}</span>
                    </h6>
                    ${updated}
                </div>
                <p class="text-muted small mb-2">${escapeHtml(p.help || "")}</p>
                <textarea class="form-control mb-2" rows="4" placeholder="${placeholder}"></textarea>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-primary btn-save">Enregistrer</button>
                    <button class="btn btn-sm btn-outline-danger btn-clear"
                            ${p.status === "absent" ? "disabled" : ""}>Effacer</button>
                    <span class="align-self-center small feedback text-muted"></span>
                </div>
            </div>
        </div>`;
    }

    async function load() {
        if (!container) return;
        try {
            const res = await fetch("/api/cookies");
            const providers = await res.json();
            container.innerHTML = providers.map(providerCard).join("");
            updateHeaderBadge(providers);
            bindCards();
        } catch (e) {
            container.innerHTML = `<div class="alert alert-danger">Erreur de chargement : ${escapeHtml(e.message)}</div>`;
        }
    }

    function bindCards() {
        container.querySelectorAll("[data-provider]").forEach(card => {
            const id = card.getAttribute("data-provider");
            const textarea = card.querySelector("textarea");
            const feedback = card.querySelector(".feedback");

            card.querySelector(".btn-save").addEventListener("click", async () => {
                const content = textarea.value.trim();
                if (!content) { feedback.textContent = "Contenu vide."; return; }
                feedback.textContent = "Enregistrement…";
                const body = new URLSearchParams({ content });
                const res = await fetch(`/api/cookies/${encodeURIComponent(id)}`, { method: "POST", body });
                feedback.textContent = await res.text();
                if (res.ok) { textarea.value = ""; load(); }
            });

            card.querySelector(".btn-clear").addEventListener("click", async () => {
                if (!confirm("Supprimer le cookie enregistré pour ce service ?")) return;
                feedback.textContent = "Suppression…";
                const res = await fetch(`/api/cookies/${encodeURIComponent(id)}`, { method: "DELETE" });
                feedback.textContent = await res.text();
                load();
            });
        });
    }

    // Recharge la liste à chaque ouverture de la modale (statut à jour).
    const modal = document.getElementById("cookies-modal");
    if (modal) modal.addEventListener("show.bs.modal", load);

    // Charge une première fois au démarrage pour afficher la pastille du header.
    document.addEventListener("DOMContentLoaded", load);
})();
