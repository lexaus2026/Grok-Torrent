/**
 * Torrent PWA – Client-side BitTorrent (WebTorrent)
 * Version 1.0 – Compatible iOS / iPadOS Safari
 */

(function () {
  'use strict';

  // ---------- State ----------
  const state = {
    client: null,
    torrents: new Map(),      // id -> { torrent, meta }
    selectedId: null,
    history: [],
  };

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    torrentList: $('#torrentList'),
    emptyState: $('#emptyState'),
    magnetInput: $('#magnetInput'),
    btnStart: $('#btnStartDownload'),
    fileInput: $('#fileInput'),
    toast: $('#toast'),
    detailName: $('#detailName'),
    detailStatus: $('#detailStatus'),
    detailPercent: $('#detailPercent'),
    detailDot: $('#detailDot'),
    panelFiles: $('#panelFiles'),
    panelInfo: $('#panelInfo'),
    pauseLabel: $('#pauseLabel'),
  };

  // ---------- Utils ----------
  function toast(msg, duration = 2800) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), duration);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)) + ' ' + sizes[i];
  }

  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec < 1) return '0 B/s';
    return formatBytes(bytesPerSec) + '/s';
  }

  function formatETA(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return Math.round(seconds) + 's';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min';
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h + 'h ' + m + 'm';
  }

  /** Convert pure info-hash to magnet */
  function infoHashToMagnet(input) {
    const cleaned = input.trim().replace(/\s+/g, '');
    // Already a magnet?
    if (cleaned.toLowerCase().startsWith('magnet:')) return cleaned;
    // Hex info-hash (40 chars)
    if (/^[a-fA-F0-9]{40}$/.test(cleaned)) {
      return `magnet:?xt=urn:btih:${cleaned.toLowerCase()}`;
    }
    // Base32 info-hash (32 chars)
    if (/^[A-Z2-7]{32}$/i.test(cleaned)) {
      return `magnet:?xt=urn:btih:${cleaned.toUpperCase()}`;
    }
    return cleaned; // hope it's a valid magnet or torrent id
  }

  function isValidInput(str) {
    if (!str || !str.trim()) return false;
    const s = str.trim();
    if (s.toLowerCase().startsWith('magnet:')) return true;
    if (/^[a-fA-F0-9]{40}$/.test(s)) return true;
    if (/^[A-Z2-7]{32}$/i.test(s)) return true;
    return false;
  }

  // ---------- IndexedDB (History) ----------
  const DB_NAME = 'torrent-pwa';
  const DB_STORE = 'history';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveHistoryEntry(entry) {
    try {
      const db = await openDB();
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).add({
        ...entry,
        date: Date.now(),
      });
      // Keep only last 50
      const all = await getHistory();
      if (all.length > 50) {
        const toDelete = all.slice(50);
        const tx2 = db.transaction(DB_STORE, 'readwrite');
        toDelete.forEach((e) => tx2.objectStore(DB_STORE).delete(e.id));
      }
    } catch (e) {
      console.warn('History save failed', e);
    }
  }

  async function getHistory() {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).getAll();
        req.onsuccess = () => {
          const items = (req.result || []).sort((a, b) => b.date - a.date);
          resolve(items);
        };
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async function clearHistory() {
    try {
      const db = await openDB();
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
    } catch (e) {
      console.warn(e);
    }
  }

  // ---------- WebTorrent ----------
  function initClient() {
    if (state.client) return state.client;
    state.client = new WebTorrent();
    state.client.on('error', (err) => {
      console.error('WebTorrent error', err);
      toast('Erreur : ' + (err.message || err));
    });
    return state.client;
  }

  function addTorrent(torrentId, opts = {}) {
    const client = initClient();
    toast('Ajout du torrent…');

    const torrent = client.add(torrentId, {
      announce: [
        'wss://tracker.btorrent.xyz',
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.webtorrent.dev',
      ],
    });

    const id = torrent.infoHash || ('tmp-' + Date.now());
    state.torrents.set(id, { torrent, meta: { addedAt: Date.now() } });

    torrent.on('metadata', () => {
      const realId = torrent.infoHash;
      if (realId && realId !== id) {
        state.torrents.delete(id);
        state.torrents.set(realId, { torrent, meta: { addedAt: Date.now() } });
      }
      saveHistoryEntry({
        name: torrent.name || realId,
        infoHash: realId,
        magnet: torrent.magnetURI,
      });
      renderList();
      toast('Métadonnées reçues : ' + (torrent.name || 'Torrent'));
    });

    torrent.on('download', () => renderList());
    torrent.on('upload', () => renderList());
    torrent.on('done', () => {
      renderList();
      toast('Téléchargement terminé : ' + (torrent.name || ''));
      // Offer download of files
      torrent.files.forEach((file) => {
        file.getBlobURL((err, url) => {
          if (err) return;
          // Keep URL for later download action
          file._blobUrl = url;
        });
      });
    });

    torrent.on('error', (err) => {
      console.error(err);
      toast('Erreur torrent : ' + (err.message || err));
      renderList();
    });

    torrent.on('warning', (err) => console.warn(err));

    renderList();
    closeScreen('addScreen');
    return torrent;
  }

  function removeTorrent(id) {
    const entry = state.torrents.get(id);
    if (!entry) return;
    try {
      entry.torrent.destroy({ destroyStore: true });
    } catch (e) {}
    state.torrents.delete(id);
    if (state.selectedId === id) {
      state.selectedId = null;
      closeScreen('detailScreen');
    }
    renderList();
    toast('Torrent supprimé');
  }

  function togglePause(id) {
    const entry = state.torrents.get(id);
    if (!entry) return;
    const t = entry.torrent;
    if (t.paused) {
      t.resume();
      toast('Repris');
    } else {
      t.pause();
      toast('En pause');
    }
    renderList();
    if (state.selectedId === id) openDetail(id);
  }

  // ---------- Render ----------
  function getStatus(torrent) {
    if (torrent.done) return 'done';
    if (torrent.paused) return 'paused';
    if (torrent.numPeers === 0 && !torrent.done) return 'downloading'; // still trying
    return 'downloading';
  }

  function renderList() {
    const list = els.torrentList;
    const empty = els.emptyState;

    if (state.torrents.size === 0) {
      list.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = '';

    state.torrents.forEach((entry, id) => {
      const t = entry.torrent;
      const status = getStatus(t);
      const percent = Math.round((t.progress || 0) * 100);
      const name = t.name || t.infoHash || 'Chargement des métadonnées…';

      const card = document.createElement('div');
      card.className = 'torrent-card';
      card.dataset.id = id;
      card.innerHTML = `
        <div class="torrent-card-header">
          <div class="torrent-icon">↓</div>
          <div class="torrent-info">
            <div class="torrent-name">${escapeHtml(name)}</div>
            <div class="torrent-status">${statusLabel(status, t)}</div>
          </div>
          <div class="torrent-percent ${status}">${percent}%</div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${status}" style="width:${percent}%"></div>
        </div>
        <div class="torrent-stats">
          <span>↓ ${formatSpeed(t.downloadSpeed)}</span>
          <span>↑ ${formatSpeed(t.uploadSpeed)}</span>
          <span>${formatETA(t.timeRemaining)}</span>
          <span>${t.numPeers || 0} pairs</span>
        </div>
      `;
      card.addEventListener('click', () => openDetail(id));
      list.appendChild(card);
    });
  }

  function statusLabel(status, t) {
    if (status === 'done') return 'Terminé';
    if (status === 'paused') return 'En pause';
    if (!t.name) return 'Récupération des métadonnées…';
    return 'Téléchargement';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- Detail ----------
  function openDetail(id) {
    const entry = state.torrents.get(id);
    if (!entry) return;
    state.selectedId = id;
    const t = entry.torrent;

    els.detailName.textContent = t.name || t.infoHash || 'Torrent';
    const status = getStatus(t);
    els.detailStatus.textContent = statusLabel(status, t);
    els.detailPercent.textContent = Math.round((t.progress || 0) * 100) + '%';
    els.detailDot.className = 'dot ' + (status === 'done' ? 'done' : status === 'paused' ? 'paused' : '');

    els.pauseLabel.textContent = t.paused ? 'Reprendre' : 'Pause';

    // Files panel
    renderFiles(t);

    // Info panel
    els.panelInfo.innerHTML = `
      <div style="font-size:14px;line-height:1.7;color:var(--text-secondary)">
        <p><strong style="color:var(--text)">Hash</strong><br><span style="font-family:monospace;font-size:12px;word-break:break-all">${t.infoHash || '—'}</span></p>
        <p style="margin-top:12px"><strong style="color:var(--text)">Taille</strong><br>${formatBytes(t.length)}</p>
        <p style="margin-top:12px"><strong style="color:var(--text)">Téléchargé</strong><br>${formatBytes(t.downloaded)} (${Math.round(t.progress * 100)}%)</p>
        <p style="margin-top:12px"><strong style="color:var(--text)">Ratio</strong><br>${(t.uploaded / (t.downloaded || 1)).toFixed(2)}</p>
        <p style="margin-top:12px"><strong style="color:var(--text)">Pairs</strong><br>${t.numPeers || 0}</p>
      </div>
    `;

    openScreen('detailScreen');
  }

  function renderFiles(torrent) {
    const panel = els.panelFiles;
    panel.innerHTML = '';
    if (!torrent.files || torrent.files.length === 0) {
      panel.innerHTML = '<p style="color:var(--text-muted);padding:20px 0">Fichiers non encore disponibles (métadonnées en cours…)</p>';
      return;
    }

    torrent.files.forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      const checked = !file.done && file._selected !== false;
      const prog = Math.round((file.progress || 0) * 100);

      item.innerHTML = `
        <div class="file-check ${file.done || checked ? 'checked' : ''}" data-idx="${idx}">
          ${file.done || checked ? '✓' : ''}
        </div>
        <div class="file-info">
          <div class="file-name">${escapeHtml(file.name)}</div>
          <div class="file-size">${formatBytes(file.length)} · ${prog}%</div>
          <div class="file-progress"><div class="file-progress-fill" style="width:${prog}%"></div></div>
        </div>
        <select class="priority-select" data-idx="${idx}">
          <option value="0">Normal</option>
          <option value="1">Haute</option>
          <option value="-1">Basse</option>
        </select>
      `;

      // Toggle select (WebTorrent uses file.select / deselect)
      item.querySelector('.file-check').addEventListener('click', (e) => {
        e.stopPropagation();
        if (file.done) return;
        if (file._selected === false) {
          file.select();
          file._selected = true;
        } else {
          file.deselect();
          file._selected = false;
        }
        renderFiles(torrent);
      });

      // Priority (best-effort – WebTorrent has limited priority support)
      item.querySelector('.priority-select').addEventListener('change', (e) => {
        // WebTorrent doesn't expose fine-grained priority the same way;
        // we keep the UI for future / visual consistency.
      });

      // Download finished file
      if (file.done) {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          if (file._blobUrl) {
            const a = document.createElement('a');
            a.href = file._blobUrl;
            a.download = file.name;
            a.click();
          } else {
            file.getBlobURL((err, url) => {
              if (err) return toast('Impossible de préparer le fichier');
              file._blobUrl = url;
              const a = document.createElement('a');
              a.href = url;
              a.download = file.name;
              a.click();
            });
          }
        });
      }

      panel.appendChild(item);
    });
  }

  // ---------- Screens ----------
  function openScreen(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  }

  function closeScreen(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }

  // ---------- History UI ----------
  async function renderHistory() {
    const items = await getHistory();
    const container = $('#historyList');
    if (!items.length) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;margin-top:40px">Aucun historique pour le moment.</p>';
      return;
    }
    container.innerHTML = items.map((item) => `
      <div class="history-item" data-magnet="${escapeHtml(item.magnet || '')}" data-hash="${escapeHtml(item.infoHash || '')}">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.name || 'Torrent')}</div>
          <div class="hash">${escapeHtml((item.infoHash || '').slice(0, 16))}…</div>
        </div>
        <div style="color:var(--text-muted);font-size:12px">${new Date(item.date).toLocaleDateString('fr')}</div>
      </div>
    `).join('');

    container.querySelectorAll('.history-item').forEach((el) => {
      el.addEventListener('click', () => {
        const magnet = el.dataset.magnet || el.dataset.hash;
        if (magnet) {
          closeScreen('historyScreen');
          addTorrent(infoHashToMagnet(magnet));
        }
      });
    });
  }

  // ---------- Events ----------
  function bindEvents() {
    // Add button (header + tab)
    $('#btnAdd').addEventListener('click', () => openScreen('addScreen'));
    $$('.tab-item').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.tab-item').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const name = tab.dataset.tab;
        if (name === 'add') openScreen('addScreen');
        else if (name === 'history') {
          renderHistory();
          openScreen('historyScreen');
        } else if (name === 'settings') openScreen('settingsScreen');
        else {
          // list – close any open screen
          closeScreen('addScreen');
          closeScreen('detailScreen');
          closeScreen('historyScreen');
          closeScreen('settingsScreen');
        }
      });
    });

    $('#btnCancelAdd').addEventListener('click', () => closeScreen('addScreen'));
    $('#btnCloseDetail').addEventListener('click', () => closeScreen('detailScreen'));
    $('#btnCloseHistory').addEventListener('click', () => closeScreen('historyScreen'));
    $('#btnCloseSettings').addEventListener('click', () => closeScreen('settingsScreen'));

    // Paste
    $('#btnPaste').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        els.magnetInput.value = text.trim();
        updateStartButton();
        toast('Collé');
      } catch {
        toast('Impossible d’accéder au presse-papiers');
      }
    });

    els.magnetInput.addEventListener('input', updateStartButton);

    function updateStartButton() {
      els.btnStart.disabled = !isValidInput(els.magnetInput.value);
    }

    // Start download
    els.btnStart.addEventListener('click', () => {
      const raw = els.magnetInput.value.trim();
      if (!isValidInput(raw)) return;
      const magnet = infoHashToMagnet(raw);
      addTorrent(magnet);
      els.magnetInput.value = '';
      updateStartButton();
    });

    // File picker
    $('#btnChooseFile').addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files[0];
      if (!file) return;
      addTorrent(file);
      els.fileInput.value = '';
    });

    // Detail actions
    $('#btnTogglePause').addEventListener('click', () => {
      if (state.selectedId) togglePause(state.selectedId);
    });
    $('#btnRemove').addEventListener('click', () => {
      if (state.selectedId && confirm('Supprimer ce torrent ?')) {
        removeTorrent(state.selectedId);
      }
    });

    // Detail tabs
    $$('#detailTabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#detailTabs button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const panel = btn.dataset.panel;
        $('#panelFiles').classList.toggle('hidden', panel !== 'files');
        $('#panelInfo').classList.toggle('hidden', panel !== 'info');
        $('#panelPeers').classList.toggle('hidden', panel !== 'peers');
      });
    });

    // Clear history
    $('#btnClearHistory').addEventListener('click', async () => {
      if (confirm('Effacer tout l’historique ?')) {
        await clearHistory();
        renderHistory();
        toast('Historique effacé');
      }
    });
  }

  // ---------- Service Worker ----------
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('SW registration failed', err);
      });
    }
  }

  // ---------- Init ----------
  function init() {
    bindEvents();
    renderList();
    registerSW();

    // Periodic UI refresh
    setInterval(() => {
      if (state.torrents.size > 0) renderList();
      if (state.selectedId && document.getElementById('detailScreen').classList.contains('open')) {
        openDetail(state.selectedId);
      }
    }, 1000);
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
