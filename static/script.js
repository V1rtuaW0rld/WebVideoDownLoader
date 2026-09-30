// ==========================================================================
// WebVideoDownLoader - Modern 2026 UI Logic
// ==========================================================================

// --- Gestion du Thème (Dark / Light Mode) ---
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

function getPreferredTheme() {
    const saved = localStorage.getItem('wvdl-theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem('wvdl-theme', theme);
    if (themeIcon) {
        if (theme === 'dark') {
            themeIcon.className = 'bi bi-moon-stars-fill';
            themeToggleBtn.title = 'Passer au mode clair';
        } else {
            themeIcon.className = 'bi bi-sun-fill text-warning';
            themeToggleBtn.title = 'Passer au mode sombre';
        }
    }
}

// Initialisation du thème
applyTheme(getPreferredTheme());

if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
    });
}

// --- Éléments du DOM ---
const form = document.getElementById('download-form');
const urlInput = document.getElementById('url');
const btnPaste = document.getElementById('btn-paste');
const videoButton = document.getElementById('btn-download-video') || document.querySelector('#download-form button.btn-primary');
const audioButton = document.getElementById('btn-download-audio') || document.querySelector('#download-form button.btn-outline-primary');
const tableBody = document.getElementById('video-table-body');
const paginationContainer = document.getElementById('pagination-container');
const output = document.getElementById('output');
const ytDlpInfo = document.getElementById('yt-dlp-info');
const tasksCountBadge = document.getElementById('tasks-count');
const logStatus = document.getElementById('log-status');
const btnClearLogs = document.getElementById('btn-clear-logs');
const logsCollapse = document.getElementById('logsCollapse');
const logsChevron = document.getElementById('logs-chevron');

let eventSource = null;
let currentPage = 1;
let totalPages = 1;
let perPage = 5;

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// --- Bouton Coller depuis le Presse-Papier ---
if (btnPaste && urlInput) {
    btnPaste.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
                urlInput.value = text.trim();
                urlInput.focus();
                btnPaste.classList.add('btn-success');
                setTimeout(() => btnPaste.classList.remove('btn-success'), 800);
            }
        } catch (err) {
            console.warn('Accès au presse-papier refusé ou non supporté:', err);
            urlInput.focus();
        }
    });
}

// --- Gestion des Logs & Terminal ---
if (btnClearLogs && output) {
    btnClearLogs.addEventListener('click', () => {
        output.textContent = 'Console effacée.\n';
        if (logStatus) {
            logStatus.textContent = 'Prêt';
            logStatus.className = 'badge rounded-pill bg-success-subtle text-success small px-2';
        }
    });
}

if (logsCollapse && logsChevron) {
    logsCollapse.addEventListener('hidden.bs.collapse', () => {
        logsChevron.className = 'bi bi-chevron-up';
    });
    logsCollapse.addEventListener('shown.bs.collapse', () => {
        logsChevron.className = 'bi bi-chevron-down';
    });
}

function appendLog(text, type = 'normal') {
    if (!output) return;
    const line = document.createElement('div');
    line.className = 'log-line';
    
    if (type === 'system') {
        line.innerHTML = `<span style="color: #38bdf8; font-weight: 600;">${escapeHtml(text)}</span>`;
    } else if (type === 'error') {
        line.innerHTML = `<span style="color: #f87171; font-weight: 500;">${escapeHtml(text)}</span>`;
    } else if (type === 'success') {
        line.innerHTML = `<span style="color: #4ade80; font-weight: 500;">${escapeHtml(text)}</span>`;
    } else {
        line.textContent = text;
    }
    
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

// --- Construction HTML d'une Ligne du Tableau ---
function buildRowHTML(task) {
    const isEpoch = /^\d{9,}$/.test(task.status);
    const progress = Math.min(100, Math.max(0, parseFloat(task.progress) || 0));
    
    // Badge Type
    const typeBadge = task.type === 'audio'
        ? `<span class="badge-type badge-audio"><i class="bi bi-music-note-beamed me-1"></i>Audio</span>`
        : `<span class="badge-type badge-video"><i class="bi bi-camera-video-fill me-1"></i>Vidéo</span>`;

    // Titre & Miniature
    const thumbUrl = task.thumbnail || '/static/images/default.gif';
    const thumbTitleHTML = `
        <div class="thumb-title-container">
            <div class="video-thumb-wrap">
                <img src="${thumbUrl}" alt="Miniature" class="video-thumb-img" loading="lazy" onerror="this.src='/static/images/default.gif'">
            </div>
            <span class="video-title-text" id="video-title-${task.task_id}" title="${escapeHtml(task.title || 'Titre inconnu')}">
                ${escapeHtml(task.title || 'Titre inconnu')}
            </span>
        </div>
    `;

    // Qualité / Résolution
    const resHTML = task.resolution && task.resolution !== 'N/A'
        ? `<span class="badge-tag badge-res">${escapeHtml(task.resolution)}</span>`
        : `<span class="badge-tag text-muted">N/A</span>`;

    // Extension
    const ext = task.filename && task.filename.includes('.') ? task.filename.split('.').pop().toUpperCase() : 'N/A';
    const extHTML = `<span class="badge-tag">${escapeHtml(ext)}</span>`;

    // Taille
    const sizeHTML = `<span class="badge-tag">${escapeHtml(task.filesize_approx || 'N/A')}</span>`;

    // Barre de progression
    const progressHTML = `
        <div class="progress-wrap" id="progress-container-${task.task_id}">
            <div class="progress progress-custom">
                <div id="progress-${task.task_id}" 
                     class="progress-bar progress-bar-custom ${isEpoch ? 'progress-bar-striped progress-bar-animated' : ''}" 
                     style="width: ${progress}%;"
                     role="progressbar" 
                     aria-valuenow="${progress}" 
                     aria-valuemin="0" 
                     aria-valuemax="100"></div>
            </div>
            <div class="d-flex justify-content-between align-items-center">
                <span id="progress-text-${task.task_id}" class="progress-percent-label">${progress.toFixed(1)}%</span>
                ${isEpoch ? '<span class="spinner-border spinner-border-sm text-primary" style="width: 11px; height: 11px; border-width: 2px;"></span>' : ''}
            </div>
        </div>
    `;

    // Boutons d'Action & Menu Déroulant
    let statusActionHTML = '';
    if (isEpoch) {
        statusActionHTML = `
            <button type="button" class="btn btn-sm btn-outline-danger btn-action-icon stop-button" data-task-id="${task.task_id}" title="Arrêter le téléchargement">
                <i class="bi bi-stop-fill"></i>
            </button>
        `;
    } else if (task.status === '0') {
        statusActionHTML = `
            <button type="button" class="btn btn-sm btn-outline-primary btn-action-icon resume-button" data-task-id="${task.task_id}" title="Reprendre le téléchargement">
                <i class="bi bi-arrow-repeat"></i>
            </button>
        `;
    } else if (task.status === '1') {
        statusActionHTML = `
            <span class="status-badge-done" title="Téléchargement terminé"><i class="bi bi-check-circle-fill"></i> Terminé</span>
        `;
    }

    const dropdownMenuHTML = `
        <div class="dropdown d-inline-block">
            <button class="btn btn-sm btn-ghost btn-action-icon dropdown-toggle-no-caret" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Options">
                <i class="bi bi-three-dots-vertical"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                <li>
                    <button type="button" class="dropdown-item d-flex align-items-center gap-2 menu-act-delete-list" data-task-id="${task.task_id}">
                        <i class="bi bi-trash text-secondary"></i>
                        <span>Supprimer de la liste</span>
                    </button>
                </li>
                <li>
                    <button type="button" class="dropdown-item d-flex align-items-center gap-2 text-danger menu-act-delete-file" data-task-id="${task.task_id}">
                        <i class="bi bi-trash3-fill"></i>
                        <span>Supprimer (liste + fichier)</span>
                    </button>
                </li>
            </ul>
        </div>
    `;

    return `
        <td class="ps-3 ps-md-4 text-secondary small font-monospace text-nowrap">${escapeHtml(task.date || 'N/A')}</td>
        <td class="text-nowrap">${typeBadge}</td>
        <td>${thumbTitleHTML}</td>
        <td class="text-secondary small font-monospace text-nowrap"><i class="bi bi-clock me-1"></i>${escapeHtml(task.duration_string || 'N/A')}</td>
        <td class="text-nowrap">${sizeHTML}</td>
        <td class="text-nowrap">${resHTML}</td>
        <td class="text-nowrap">${extHTML}</td>
        <td>${progressHTML}</td>
        <td class="text-end pe-3 pe-md-4 text-nowrap">
            <div class="d-flex align-items-center justify-content-end gap-2">
                ${statusActionHTML}
                ${dropdownMenuHTML}
            </div>
        </td>
    `;
}

// --- Liaison des Événements sur une Ligne ---
function bindRowEvents(row) {
    const taskId = row.getAttribute('data-task-id');
    if (!taskId) return;

    // Bouton Reprendre
    const resumeBtn = row.querySelector('.resume-button');
    if (resumeBtn) {
        resumeBtn.onclick = async () => {
            appendLog(`[SYSTEM] Reprise de la tâche ${taskId}...`, 'system');
            try {
                const response = await fetch('/resume', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `task_id=${encodeURIComponent(taskId)}`
                });
                const txt = await response.text();
                appendLog(txt, response.ok ? 'success' : 'error');
            } catch (e) {
                appendLog(`Erreur lors de la reprise: ${e.message}`, 'error');
            }
        };
    }

    // Bouton Arrêter
    const stopBtn = row.querySelector('.stop-button');
    if (stopBtn) {
        stopBtn.onclick = async () => {
            appendLog(`[SYSTEM] Arrêt de la tâche ${taskId}...`, 'system');
            try {
                const response = await fetch('/stop-task', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `task_id=${encodeURIComponent(taskId)}`
                });
                if (response.ok) {
                    appendLog(`🛑 Tâche ${taskId} arrêtée.`, 'system');
                } else {
                    appendLog("Erreur lors de l'arrêt.", 'error');
                }
            } catch (e) {
                appendLog(`Erreur lors de l'arrêt: ${e.message}`, 'error');
            }
        };
    }

    // Bouton Menu "Supprimer de la liste"
    const delListBtn = row.querySelector('.menu-act-delete-list');
    if (delListBtn) {
        delListBtn.onclick = () => submitDelete(taskId, false);
    }

    // Bouton Menu "Supprimer liste + fichier"
    const delFileBtn = row.querySelector('.menu-act-delete-file');
    if (delFileBtn) {
        delFileBtn.onclick = () => {
            if (confirm("Supprimer cette tâche de l'historique ET le fichier téléchargé du disque ?")) {
                submitDelete(taskId, true);
            }
        };
    }
}

// --- Chargement d'une Page via SSE ---
function loadPage(page) {
    if (page < 1 || (totalPages > 0 && page > totalPages)) return;
    currentPage = page;

    if (eventSource && eventSource.readyState !== 2) {
        eventSource.close();
    }

    eventSource = new EventSource(`/stream?page=${page}`);
    eventSource.onmessage = handleMessage;
    eventSource.onerror = (e) => {
        console.warn('Stream déconnecté, reconnexion dans 2s...', e);
        setTimeout(() => {
            if (eventSource.readyState === 2) loadPage(currentPage);
        }, 2000);
    };
}

// --- Traitement des Messages SSE ---
function handleMessage(event) {
    if (!event.data) return;
    const rawData = event.data.replace('data: ', '').trim();

    // InitialData (données de pagination et liste des tâches)
    if (rawData.startsWith('{') && rawData.endsWith('}')) {
        try {
            const parsed = JSON.parse(rawData);
            if (parsed.type === 'InitialData') {
                tableBody.innerHTML = '';
                parsed.tasks.forEach(task => {
                    const row = document.createElement('tr');
                    row.setAttribute('data-task-id', task.task_id);
                    row.innerHTML = buildRowHTML(task);
                    tableBody.appendChild(row);
                    bindRowEvents(row);
                });

                currentPage = parsed.pagination.current_page;
                totalPages = parsed.pagination.total_pages;
                perPage = parsed.pagination.per_page;

                if (tasksCountBadge) {
                    tasksCountBadge.textContent = `${parsed.pagination.total_items} élément${parsed.pagination.total_items > 1 ? 's' : ''}`;
                }

                renderPagination();
                return;
            }
        } catch (e) {
            console.error('Erreur parsing JSON InitialData:', e);
        }
    }

    // Messages formatés : [task_id] Message
    const match = rawData.match(/\[([^\]]+)\]\s*(.+)/);
    if (match) {
        const taskId = match[1];
        const dataContent = match[2];

        // 1. Mise à jour complète de la tâche
        if (dataContent.startsWith('VideoInfo:')) {
            try {
                const videoInfo = JSON.parse(dataContent.replace('VideoInfo:', '').trim());
                let row = document.querySelector(`tr[data-task-id="${taskId}"]`);
                if (!row) {
                    row = document.createElement('tr');
                    row.setAttribute('data-task-id', taskId);
                    row.innerHTML = buildRowHTML(videoInfo);
                    tableBody.insertBefore(row, tableBody.firstChild);
                } else {
                    row.innerHTML = buildRowHTML(videoInfo);
                }
                bindRowEvents(row);
            } catch (e) {
                console.error(`Erreur parsing VideoInfo:`, e);
            }
        }
        // 2. Progression de téléchargement
        else if (dataContent.startsWith('Progress:')) {
            const percentage = parseFloat(dataContent.replace('Progress:', '').trim());
            const progressBar = document.getElementById(`progress-${taskId}`);
            const progressText = document.getElementById(`progress-text-${taskId}`);
            if (progressBar) {
                progressBar.style.width = `${percentage}%`;
                progressBar.setAttribute('aria-valuenow', percentage);
            }
            if (progressText) {
                progressText.textContent = `${percentage.toFixed(1)}%`;
            }
            if (logStatus) {
                logStatus.textContent = 'Téléchargement...';
                logStatus.className = 'badge rounded-pill bg-primary-subtle text-primary small px-2';
            }
        }
        // 3. Message système ou log yt-dlp
        else {
            if (rawData.startsWith('[SYSTEM]')) {
                appendLog(rawData, 'system');
            } else if (rawData.includes('❌') || rawData.includes('Erreur')) {
                appendLog(rawData, 'error');
            } else if (rawData.includes('✅')) {
                appendLog(rawData, 'success');
                if (logStatus) {
                    logStatus.textContent = 'Prêt';
                    logStatus.className = 'badge rounded-pill bg-success-subtle text-success small px-2';
                }
            } else {
                appendLog(rawData, 'normal');
            }
        }
    } else {
        appendLog(rawData, 'normal');
    }
}

// --- Rendu de la Pagination ---
function renderPagination() {
    if (!paginationContainer) return;
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    paginationContainer.innerHTML = `
        <nav aria-label="Pagination des tâches">
            <ul class="pagination pagination-sm mb-0 gap-1">
                <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                    <button class="page-link rounded-2" onclick="loadPage(1)" title="Première page">&laquo;&laquo;</button>
                </li>
                <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                    <button class="page-link rounded-2" onclick="loadPage(${currentPage - 1})" title="Précédente">&laquo;</button>
                </li>
                <li class="page-item disabled">
                    <span class="page-link rounded-2 fw-medium">Page ${currentPage} / ${totalPages}</span>
                </li>
                <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                    <button class="page-link rounded-2" onclick="loadPage(${currentPage + 1})" title="Suivante">&raquo;</button>
                </li>
                <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                    <button class="page-link rounded-2" onclick="loadPage(${totalPages})" title="Dernière page">&raquo;&raquo;</button>
                </li>
            </ul>
        </nav>
    `;
}

// --- Soumission Téléchargement Vidéo & Audio ---
if (form) {
    form.addEventListener('submit', (e) => e.preventDefault());
}

async function triggerDownload(endpoint, modeLabel) {
    const url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
        appendLog('❌ URL manquante !', 'error');
        if (urlInput) urlInput.focus();
        return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        appendLog('❌ URL invalide ! Veuillez saisir un lien HTTP ou HTTPS.', 'error');
        if (urlInput) urlInput.focus();
        return;
    }

    appendLog(`🚀 Lancement du téléchargement ${modeLabel}...`, 'system');
    if (logStatus) {
        logStatus.textContent = 'En cours...';
        logStatus.className = 'badge rounded-pill bg-warning-subtle text-warning small px-2';
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `url=${encodeURIComponent(url)}`
        });
        const text = await res.text();
        appendLog(text, res.ok ? 'success' : 'error');
        if (res.ok && urlInput) {
            urlInput.value = '';
        }
    } catch (e) {
        appendLog(`Erreur réseau: ${e.message}`, 'error');
    }
}

if (videoButton) {
    videoButton.addEventListener('click', (e) => {
        e.preventDefault();
        triggerDownload('/download', 'vidéo');
    });
}

if (audioButton) {
    audioButton.addEventListener('click', (e) => {
        e.preventDefault();
        triggerDownload('/download-audio', 'audio MP3');
    });
}

// --- Gestion des Suppressions ---
async function submitDelete(taskId, deleteFile) {
    if (!taskId) return;
    try {
        const formData = new URLSearchParams();
        formData.append('task_id', taskId);
        formData.append('delete_file', deleteFile);

        const res = await fetch('/delete-task', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            const row = document.querySelector(`tr[data-task-id="${taskId}"]`);
            if (row) {
                row.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                row.style.opacity = '0';
                row.style.transform = 'translateX(20px)';
                setTimeout(() => row.remove(), 250);
            }
            appendLog(`🗑️ Tâche ${taskId} supprimée${deleteFile ? ' (+ fichier disque)' : ''}.`, 'system');
        } else {
            alert("Erreur lors de la suppression de la tâche.");
        }
    } catch (e) {
        console.error("Erreur de suppression:", e);
    }
}

// --- Menu Contextuel (Clic Droit) ---
const contextMenu = document.getElementById('context-menu');
let currentContextTaskId = null;

document.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
});

if (tableBody) {
    tableBody.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('tr');
        if (row && contextMenu) {
            e.preventDefault();
            currentContextTaskId = row.getAttribute('data-task-id');
            if (currentContextTaskId) {
                contextMenu.style.display = 'block';
                contextMenu.style.visibility = 'hidden';

                const menuWidth = contextMenu.offsetWidth;
                const menuHeight = contextMenu.offsetHeight;
                let left = e.pageX;
                let top = e.pageY;

                if (left + menuWidth > window.innerWidth) left = e.pageX - menuWidth;
                if (top + menuHeight > window.innerHeight) top = e.pageY - menuHeight;

                contextMenu.style.left = `${left}px`;
                contextMenu.style.top = `${top}px`;
                contextMenu.style.visibility = 'visible';
            }
        }
    });
}

const menuDeleteList = document.getElementById('menu-delete-list');
if (menuDeleteList) {
    menuDeleteList.addEventListener('click', async () => {
        await submitDelete(currentContextTaskId, false);
    });
}

const menuDeleteFile = document.getElementById('menu-delete-file');
if (menuDeleteFile) {
    menuDeleteFile.addEventListener('click', async () => {
        if (confirm("Supprimer cette tâche de l'historique ET le fichier téléchargé du disque ?")) {
            await submitDelete(currentContextTaskId, true);
        }
    });
}

// --- Vérification et Mise à Jour de yt-dlp ---
async function checkYtDlpUpdate() {
    if (!ytDlpInfo) return;
    ytDlpInfo.innerHTML = '<span class="text-secondary small"><span class="spinner-border spinner-border-sm me-1"></span>yt-dlp...</span>';
    
    try {
        const response = await fetch('/api/yt-dlp-status');
        const data = await response.json();
        const badgeClass = data.update_available ? 'update-available' : 'up-to-date';
        const badgeIcon = data.update_available ? '<i class="bi bi-arrow-up-circle-fill me-1"></i>' : '<i class="bi bi-check-circle-fill me-1"></i>';
        const badgeText = data.update_available ? 'MàJ dispo' : 'À jour';

        ytDlpInfo.innerHTML = `
            <div class="d-flex align-items-center gap-2">
                <span class="version-pill ${badgeClass}">
                    ${badgeIcon}yt-dlp: <strong>${data.current}</strong> (${badgeText})
                </span>
                ${data.update_available ? `<button id="btn-update-yt-dlp" class="btn btn-sm">Mettre à jour</button>` : ''}
            </div>
        `;

        if (data.update_available) {
            const btnUpdate = document.getElementById('btn-update-yt-dlp');
            if (btnUpdate) btnUpdate.addEventListener('click', updateYtDlp);
        }
    } catch (e) {
        console.error('Erreur status yt-dlp:', e);
        ytDlpInfo.innerHTML = '<span class="text-danger small"><i class="bi bi-exclamation-triangle-fill me-1"></i>Version inconnue</span>';
    }
}

async function updateYtDlp() {
    const btn = document.getElementById('btn-update-yt-dlp');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Mise à jour...';
    }
    appendLog('[SYSTEM] Lancement de la mise à jour de yt-dlp...', 'system');

    try {
        const response = await fetch('/api/yt-dlp-update', { method: 'POST' });
        const txt = await response.text();
        appendLog(txt, response.ok ? 'success' : 'error');
    } catch (e) {
        appendLog(`❌ Erreur réseau lors de la mise à jour: ${e.message}`, 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Réessayer';
        }
    }
}

// Vérification de version toutes les heures
setInterval(checkYtDlpUpdate, 3600000);

// --- Initialisation au Démarrage ---
loadPage(1);
checkYtDlpUpdate();