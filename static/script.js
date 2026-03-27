const form = document.getElementById('download-form');
const output = document.getElementById('output');
const tableBody = document.getElementById('video-table-body');
const paginationContainer = document.getElementById('pagination-container');
const videoButton = document.querySelector('#download-form button.btn-outline-primary'); // Bouton vidéo
const audioButton = document.querySelector('#download-form button.btn-outline-secondary'); // Bouton audio
const urlInput = document.getElementById('url');
const ytDlpInfo = document.getElementById('yt-dlp-info');

let eventSource = new EventSource('/stream?page=1');
let currentPage = 1;
let totalPages = 1;
let perPage = 5;

function loadPage(page) {
 if (page < 1 || page > totalPages) {
 console.warn(`Page ${page} hors limites (1 à ${totalPages})`);
 return;
 }
 currentPage = page;
 if (eventSource.readyState !== 2) eventSource.close(); // Ferme seulement si actif
 eventSource = new EventSource(`/stream?page=${page}`);
 eventSource.onmessage = handleMessage;
 eventSource.onerror = (e) => {
 console.error('Erreur stream:', e);
 output.textContent += 'Erreur de connexion au stream.\n';
 setTimeout(() => loadPage(currentPage), 1000); // Reconnexion auto
 };
 console.log(`Chargement de la page ${page}`);
}

function handleMessage(event) {
    console.log("Message brut reçu:", event.data);
    if (event.data) {
        const data = event.data.replace('data: ', '').trim();
        console.log("Données traitées:", data);
        if (data.startsWith('{') && data.endsWith('}')) {
            try {
                const initialData = JSON.parse(data);
                console.log("Données initiales:", initialData);
                if (initialData.type === 'InitialData') {
                    tableBody.innerHTML = '';
                    initialData.tasks.forEach(task => {
                        const row = document.createElement('tr');
                        row.setAttribute('data-task-id', task.task_id);
                        // Détecte si status est un timestamp epoch
                        const isEpoch = /^\d{9,}$/.test(task.status);
                        // Remplace le texte "audio" ou "video" par les icônes
                        let typeContent = task.type === 'audio' 
                            ? `<img src="/static/images/sound.png" alt="Audio" style="max-width: 100px; max-height: 100px;">`
                            : task.type === 'video' 
                            ? `<img src="/static/images/video.png" alt="Vidéo" style="max-width: 100px; max-height: 100px;">`
                            : task.type || 'N/A';
                        row.innerHTML = `
                            <td>${task.date || 'N/A'}</td>
                            <td>${typeContent}</td> <!-- Colonne Type avec icônes -->
                            <td id="video-title-${task.task_id}">${task.title || 'N/A'}</td>
                            <td id="video-thumbnail-${task.task_id}">${task.thumbnail ? `<img src="${task.thumbnail}" alt="Miniature" style="max-width: 100px; max-height: 100px;">` : 'N/A'}</td>
                            <td id="video-duration-${task.task_id}">${task.duration_string || 'N/A'}</td>
                            <td id="video-filesize-${task.task_id}">${task.filesize_approx || 'N/A'}</td>
                            <td id="video-resolution-${task.task_id}">${task.resolution || 'N/A'}</td>
                            <td id="video-filename-${task.task_id}">${task.filename || 'N/A'}</td>
                            <td><div id="progress-container-${task.task_id}"><progress id="progress-${task.task_id}" value="${task.progress || 0}" max="100"></progress><span id="progress-text-${task.task_id}">${(task.progress || 0).toFixed(1)}%</span></div></td>
                            <td>
                                ${isEpoch ? `<img src="/static/images/stop-button.png" alt="Arrêter" title="Arrêter" style="max-width: 30px; max-height: 30px; cursor: pointer;" class="stop-button" data-task-id="${task.task_id}">` : ''}
                                ${task.status === '0' ? `<img src="/static/images/resume-button.png" alt="Reprendre" title="Reprendre" style="max-width: 30px; max-height: 30px; cursor: pointer;" class="resume-button" data-task-id="${task.task_id}">` : ''}
                                ${task.status === '1' ? `<img src="/static/images/ok.png" alt="Terminé" style="max-width: 30px; max-height: 30px;">` : ''}
                            </td>
                        `;
                        tableBody.appendChild(row);
                    });
                    // Ajouter les gestionnaires de clic pour resume-button
                    document.querySelectorAll('.resume-button').forEach(button => {
                        button.addEventListener('click', async () => {
                            const taskId = button.getAttribute('data-task-id');
                            const response = await fetch('/resume', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                body: `task_id=${encodeURIComponent(taskId)}`
                            });
                            if (response.ok) {
                                output.textContent += await response.text() + '\n';
                                // loadPage(currentPage); // Pas besoin de reload avec SSE
                            } else {
                                output.textContent += 'Erreur lors de la reprise.\n';
                            }
                        });
                    });

                    // Ajouter les gestionnaires de clic pour stop-button
                    document.querySelectorAll('.stop-button').forEach(button => {
                        button.addEventListener('click', async () => {
                            const taskId = button.getAttribute('data-task-id');
                            const response = await fetch('/stop-task', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                body: `task_id=${encodeURIComponent(taskId)}`
                            });
                            if (response.ok) {
                                output.textContent += `🛑 Tâche ${taskId} arrêtée.\n`;
                            } else {
                                output.textContent += 'Erreur lors de l\'arrêt.\n';
                            }
                        });
                    });
                    currentPage = initialData.pagination.current_page;
                    totalPages = initialData.pagination.total_pages;
                    per_page = initialData.pagination.per_page;
                    renderPagination();
                }
            } catch (e) {
                console.error('Erreur parsing JSON:', e, data);
                output.textContent += 'Erreur lors du traitement des données.\n';
            }
        } else {
            const match = data.match(/\[([^\]]+)\]\s*(.+)/);
            if (match) {
                const taskId = match[1];
                const dataContent = match[2];
                if (dataContent.startsWith('VideoInfo:')) {
                    try {
                        const videoInfo = JSON.parse(dataContent.replace('VideoInfo:', '').trim());
                        let row = document.querySelector(`tr[data-task-id="${taskId}"]`);
                        
                        // Détecte si status est un timestamp epoch
                        const isEpoch = /^\d{9,}$/.test(videoInfo.status);
                        // Remplace le texte "audio" ou "video" par les icônes
                        let typeContent = videoInfo.type === 'audio' 
                            ? `<img src="/static/images/sound.png" alt="Audio" style="width: 50px; height: 50px; max-width: 50px; max-height: 50px; object-fit: contain;">`
                            : videoInfo.type === 'video' 
                            ? `<img src="/static/images/video.png" alt="Vidéo" style="width: 50px; height: 50px; max-width: 50px; max-height: 50px; object-fit: contain;">`
                            : videoInfo.type || 'N/A';
                        
                        const rowHTML = `
                            <td>${videoInfo.date || 'N/A'}</td>
                            <td>${typeContent}</td>
                            <td id="video-title-${taskId}">${videoInfo.title || 'N/A'}</td>
                            <td id="video-thumbnail-${taskId}">${videoInfo.thumbnail ? `<img src="${videoInfo.thumbnail}" alt="Miniature" style="max-width: 100px; max-height: 100px;">` : 'N/A'}</td>
                            <td id="video-duration-${taskId}">${videoInfo.duration_string || 'N/A'}</td>
                            <td id="video-filesize-${taskId}">${videoInfo.filesize_approx || 'N/A'}</td>
                            <td id="video-resolution-${taskId}">${videoInfo.resolution || 'N/A'}</td>
                            <td id="video-filename-${taskId}">${videoInfo.filename || 'N/A'}</td>
                            <td><div id="progress-container-${taskId}"><progress id="progress-${taskId}" value="${videoInfo.progress || 0}" max="100"></progress><span id="progress-text-${taskId}">${(videoInfo.progress || 0).toFixed(1)}%</span></div></td>
                            <td>
                                ${isEpoch ? `<img src="/static/images/stop-button.png" alt="Arrêter" title="Arrêter" style="max-width: 30px; max-height: 30px; cursor: pointer;" class="stop-button" data-task-id="${taskId}">` : ''}
                                ${videoInfo.status === '0' ? `<img src="/static/images/resume-button.png" alt="Reprendre" title="Reprendre" style="max-width: 30px; max-height: 30px; cursor: pointer;" class="resume-button" data-task-id="${taskId}">` : ''}
                                ${videoInfo.status === '1' ? `<img src="/static/images/ok.png" alt="Terminé" style="max-width: 30px; max-height: 30px;">` : ''}
                            </td>
                        `;

                        if (!row) {
                            row = document.createElement('tr');
                            row.setAttribute('data-task-id', taskId);
                            row.innerHTML = rowHTML;
                            tableBody.insertBefore(row, tableBody.firstChild);
                        } else {
                            // Mise à jour de la ligne existante
                            row.innerHTML = rowHTML;
                        }

                        // Réattacher les événements
                        const resumeBtn = row.querySelector('.resume-button');
                        if (resumeBtn) {
                            resumeBtn.onclick = async () => {
                                const response = await fetch('/resume', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                    body: `task_id=${encodeURIComponent(taskId)}`
                                });
                                if (response.ok) {
                                    output.textContent += await response.text() + '\n';
                                } else {
                                    output.textContent += 'Erreur lors de la reprise.\n';
                                }
                            };
                        }

                        const stopBtn = row.querySelector('.stop-button');
                        if (stopBtn) {
                            stopBtn.onclick = async () => {
                                const response = await fetch('/stop-task', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                    body: `task_id=${encodeURIComponent(taskId)}`
                                });
                                if (response.ok) {
                                    output.textContent += `🛑 Tâche ${taskId} arrêtée.\n`;
                                } else {
                                    output.textContent += 'Erreur lors de l\'arrêt.\n';
                                }
                            };
                        }
                    } catch (e) {
                        console.error(`Erreur parsing VideoInfo: ${e}`);
                    }
                } else if (dataContent.startsWith('Progress:')) {
                    const percentage = parseFloat(dataContent.replace('Progress:', '').trim());
                    const progress = document.getElementById(`progress-${taskId}`);
                    const progressText = document.getElementById(`progress-text-${taskId}`);
                    if (progress && progressText) {
                        progress.value = percentage;
                        progressText.textContent = `${percentage.toFixed(1)}%`;
                    } else {
                        console.warn(`Éléments progress non trouvés pour ${taskId}`);
                    }
                } else {
                    // Vérifier si c'est un message système
                    if (data.startsWith('[SYSTEM]')) {
                        const msg = data.replace('[SYSTEM]', '').trim();
                        output.innerHTML += `<span style="color: #0056b3; font-weight: bold;">[SYSTEM] ${msg}</span>\n`;
                    } else {
                        output.textContent += `${data}\n`;
                    }
                    output.scrollTop = output.scrollHeight;
                }
            }
        }
    }
}

function renderPagination() {
 if (totalPages <= 1) {
 paginationContainer.innerHTML = '';
 return;
 }
 paginationContainer.innerHTML = `
 <nav aria-label="Pagination des tâches">
 <ul class="pagination">
 <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
 <a class="page-link" href="#" onclick="loadPage(1)">Première</a>
 </li>
 <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
 <a class="page-link" href="#" onclick="loadPage(${currentPage - 1})">Précédente</a>
 </li>
 <li class="page-item disabled"><span class="page-link">Page ${currentPage} sur ${totalPages}</span></li>
 <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
 <a class="page-link" href="#" onclick="loadPage(${currentPage + 1})">Suivante</a>
 </li>
 <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
 <a class="page-link" href="#" onclick="loadPage(${totalPages})">Dernière</a>
 </li>
 <li class="page-item">
 <input type="number" class="form-control form-control-sm d-inline-block w-auto mx-2" id="page-input" min="1" max="${totalPages}" value="${currentPage}" style="width: 80px;" onchange="loadPage(this.value)">
 </li>
 </ul>
 </nav>
 `;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault(); // Désactiver le submit par défaut du formulaire
    // Ne rien faire ici, on gère les boutons individuellement
});

videoButton.addEventListener('click', async (e) => {
    e.preventDefault(); // Empêche le comportement par défaut du submit
    output.textContent = 'Démarrage vidéo...\n';
    const url = urlInput.value.trim();
    if (!url) {
        output.textContent += '❌ URL manquante !\n';
        return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        output.textContent += '❌ URL invalide !\n';
        return;
    }
    const res = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `url=${encodeURIComponent(url)}`
    });
    if (res.ok) {
        const text = await res.text();
        output.textContent += text + '\n';
    } else {
        output.textContent += 'Erreur lors du démarrage vidéo.\n';
    }
});

audioButton.addEventListener('click', async (e) => {
    e.preventDefault(); // Empêche le comportement par défaut du submit
    output.textContent = 'Démarrage audio...\n';
    const url = urlInput.value.trim();
    if (!url) {
        output.textContent += '❌ URL manquante !\n';
        return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        output.textContent += '❌ URL invalide !\n';
        return;
    }
    const res = await fetch('/download-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `url=${encodeURIComponent(url)}`
    });
    if (res.ok) {
        const text = await res.text();
        output.textContent += text + '\n';
    } else {
        output.textContent += 'Erreur lors du démarrage audio.\n';
    }
});

async function checkYtDlpUpdate() {
    ytDlpInfo.innerHTML = '<span class="text-muted">Vérification yt-dlp...</span>';
    try {
        const response = await fetch('/api/yt-dlp-status');
        const data = await response.json();
        const badgeClass = data.update_available ? 'update-available' : 'up-to-date';
        const badgeText = data.update_available ? 'Mise à jour disponible' : 'À jour';

        ytDlpInfo.innerHTML = `
            <span>yt-dlp : <strong>${data.current}</strong></span>
            <span class="version-badge ${badgeClass}">${badgeText}</span>
            ${data.update_available ? `<button id="btn-update-yt-dlp" class="btn btn-sm">Mettre à jour</button>` : ''}
        `;

        if (data.update_available) {
            document.getElementById('btn-update-yt-dlp').addEventListener('click', updateYtDlp);
        }
    } catch (e) {
        console.error('Erreur status yt-dlp:', e);
        ytDlpInfo.innerHTML = '<span class="text-danger">Erreur version yt-dlp</span>';
    }
}

async function updateYtDlp() {
    const btn = document.getElementById('btn-update-yt-dlp');
    btn.disabled = true;
    btn.textContent = 'Mise à jour...';
    output.textContent += '[SYSTEM] Lancement de la mise à jour de yt-dlp...\n';

    try {
        const response = await fetch('/api/yt-dlp-update', { method: 'POST' });
        if (response.ok) {
            output.textContent += await response.text() + '\n';
        } else {
            output.textContent += '❌ Erreur lors du lancement de la mise à jour.\n';
            btn.disabled = false;
            btn.textContent = 'Réessayer';
        }
    } catch (e) {
        console.error('Erreur update yt-dlp:', e);
        output.textContent += '❌ Erreur réseau lors de la mise à jour.\n';
        btn.disabled = false;
        btn.textContent = 'Réessayer';
    }
}

// Vérification yt-dlp toutes les heures
setInterval(checkYtDlpUpdate, 3600000);

// Menu Contextuel pour suppression
const contextMenu = document.getElementById('context-menu');
let currentContextTaskId = null;

// Cacher le menu au clic ailleurs
document.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
});

// Intercepter le clic droit sur le tableau
if (tableBody) {
    tableBody.addEventListener('contextmenu', (e) => {
        const td = e.target.closest('td');
        // Vérifier si c'est la colonne Action (index 9)
        if (td && td.cellIndex === 9) {
            e.preventDefault();
            const row = td.closest('tr');
            if (row) {
                currentContextTaskId = row.getAttribute('data-task-id');
                if (currentContextTaskId && contextMenu) {
                    // Afficher temporairement pour calculer les dimensions
                    contextMenu.style.display = 'block';
                    contextMenu.style.visibility = 'hidden';
                    
                    const menuWidth = contextMenu.offsetWidth;
                    const menuHeight = contextMenu.offsetHeight;
                    const windowWidth = window.innerWidth;
                    const windowHeight = window.innerHeight;
                    
                    let left = e.pageX;
                    let top = e.pageY;
                    
                    // Si le menu dépasse à droite, on le décale à gauche de la souris
                    if (left + menuWidth > windowWidth) {
                        left = e.pageX - menuWidth;
                    }
                    // Si le menu dépasse en bas, on le remonte
                    if (top + menuHeight > windowHeight) {
                        top = e.pageY - menuHeight;
                    }
                    
                    contextMenu.style.left = `${left}px`;
                    contextMenu.style.top = `${top}px`;
                    contextMenu.style.visibility = 'visible';
                }
            }
        }
    });
}

// Gérer les actions du menu de suppression
document.getElementById('menu-delete-list')?.addEventListener('click', async () => {
    await submitDelete(currentContextTaskId, false);
});

document.getElementById('menu-delete-file')?.addEventListener('click', async () => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cette tâche de l'historique ET le fichier téléchargé du disque ?")) {
        await submitDelete(currentContextTaskId, true);
    }
});

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
                // Animation de suppression fluide
                row.style.transition = 'opacity 0.3s ease';
                row.style.opacity = '0';
                setTimeout(() => row.remove(), 300);
            }
        } else {
            alert("Erreur lors de la suppression de la tâche.");
        }
    } catch (e) {
        console.error("Erreur de suppression", e);
    }
}

// Initialisation
loadPage(1);
checkYtDlpUpdate();