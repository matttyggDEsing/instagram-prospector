// IG Growth Prospector - Popup Logic

// ─── State ───────────────────────────────────────────────────────────────────
let currentProfile = null;
let currentAnalysis = null;
let prospects = [];

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadProspects();
  setupTabs();
  setupButtons();
  renderProspectsList();
  renderExportTab();
  checkCurrentTab();
});

// ─── Tab check ───────────────────────────────────────────────────────────────
async function checkCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('instagram.com')) {
    setStatus('No estás en Instagram', false);
    document.getElementById('analyze-content').innerHTML = `
      <div class="not-ig">
        <div class="icon">🔒</div>
        <h2>No estás en Instagram</h2>
        <p>Navega a <strong>instagram.com</strong> y abre el perfil que quieres analizar.</p>
      </div>`;
  } else {
    setStatus('Instagram detectado', true);
    // Si estamos en un perfil específico
    const match = tab.url.match(/instagram\.com\/([^\/\?]+)\/?$/);
    if (match && !['explore','reels','stories','direct','accounts'].includes(match[1])) {
      document.getElementById('analyze-content').innerHTML = `
        <div class="empty-state">
          <div class="emoji">👤</div>
          <h3>@${match[1]}</h3>
          <p>Perfil detectado. Presiona el botón para analizarlo.</p>
          <br/>
          <button class="btn btn-primary btn-full" id="btn-analyze">🔍 Analizar este perfil</button>
        </div>`;
      document.getElementById('btn-analyze')?.addEventListener('click', analyzeProfile);
    } else {
      document.getElementById('analyze-content').innerHTML = `
        <div class="empty-state">
          <div class="emoji">📸</div>
          <h3>Navega a un perfil</h3>
          <p>Haz clic en cualquier cuenta de Instagram y vuelve aquí para analizarla.</p>
        </div>`;
    }
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
function setupButtons() {
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-export-json').addEventListener('click', exportJSON);
  document.getElementById('btn-clear-all').addEventListener('click', clearAll);
}

// ─── Analyze Profile ─────────────────────────────────────────────────────────
async function analyzeProfile() {
  setStatus('Analizando...', null, true);
  document.getElementById('analyze-content').innerHTML = `
    <div class="loader"><div class="spinner"></div>Extrayendo datos del perfil...</div>`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_PROFILE' });

    if (!result?.success || !result.profile?.username) {
      throw new Error('No se pudo extraer el perfil. ¿Estás en una página de perfil?');
    }

    currentProfile = result.profile;
    currentAnalysis = result.analysis;
    setStatus(`@${currentProfile.username} analizado`, true);
    renderProfileResult(currentProfile, currentAnalysis);

  } catch (err) {
    setStatus('Error al analizar', false);
    document.getElementById('analyze-content').innerHTML = `
      <div class="empty-state">
        <div class="emoji">⚠️</div>
        <h3>No se pudo analizar</h3>
        <p>${err.message || 'Asegúrate de estar en un perfil público de Instagram y vuelve a intentarlo.'}</p>
        <br/>
        <button class="btn btn-primary btn-full" id="btn-analyze">🔄 Reintentar</button>
      </div>`;
    document.getElementById('btn-analyze')?.addEventListener('click', analyzeProfile);
  }
}

// ─── Analyze Following List (buscar mejores prospectos) ──────────────────────
const tierColorsGlobal = {
  'HOT 🔥': '#ff4545',
  'WARM ✨': '#ff8c00',
  'LUKEWARM 👀': '#f0c040',
  'COLD ❄️': '#7fb3d3'
};

const MAX_FOLLOWING_TO_ANALYZE = 25; // límite para no tardar/abusar demasiado

async function analyzeFollowingBatch() {
  const container = document.getElementById('following-results');
  const btn = document.getElementById('btn-analyze-following');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 1. Pedir al content script la lista de usuarios del diálogo abierto
    const listResult = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_FOLLOWERS_LIST' });
    const users = listResult?.users || [];

    if (users.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:16px 8px">
          <div class="emoji">⚠️</div>
          <p>No encontré una lista abierta. Abrí el diálogo de <strong>"following"</strong> en el perfil de Instagram (sin cerrarlo) y volvé a presionar el botón.</p>
        </div>`;
      return;
    }

    btn.disabled = true;
    const toAnalyze = users.slice(0, MAX_FOLLOWING_TO_ANALYZE);
    const results = [];

    for (let i = 0; i < toAnalyze.length; i++) {
      const user = toAnalyze[i];
      btn.textContent = `⏳ Analizando ${i + 1}/${toAnalyze.length}: @${user.username}`;
      container.innerHTML = `<div class="loader"><div class="spinner"></div>Analizando @${user.username} (${i + 1}/${toAnalyze.length})...</div>`;

      try {
        const data = await analyzeProfileInBackgroundTab(user.profileUrl);
        if (data?.profile?.username) {
          results.push({ ...data.profile, score: data.analysis.score, tier: data.analysis.tier });
        }
      } catch (e) {
        // Si falla un perfil (privado, eliminado, etc.) lo saltamos
        console.warn('No se pudo analizar', user.username, e);
      }
    }

    btn.disabled = false;
    btn.textContent = '🚀 Analizar sus seguidos (buscar mejores prospectos)';

    renderFollowingResults(results);

  } catch (err) {
    container.innerHTML = `
      <div class="empty-state" style="padding:16px 8px">
        <div class="emoji">⚠️</div>
        <p>Error: ${err.message || err}</p>
      </div>`;
    btn.disabled = false;
    btn.textContent = '🚀 Analizar sus seguidos (buscar mejores prospectos)';
  }
}

// Abre una pestaña en background, espera que cargue, extrae el perfil y la cierra
function analyzeProfileInBackgroundTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (newTab) => {
      const tabId = newTab.id;
      let settled = false;

      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.remove(tabId).catch(() => {});
      };

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === 'complete') {
          // Pequeño delay para que el content script termine de renderizar el header
          setTimeout(async () => {
            try {
              const result = await chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_PROFILE' });
              finish(() => resolve(result));
            } catch (e) {
              finish(() => reject(e));
            }
          }, 1500);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      // Timeout de seguridad
      setTimeout(() => finish(() => reject(new Error('timeout'))), 15000);
    });
  });
}

// ─── Render resultados del análisis de "seguidos" ─────────────────────────────
function renderFollowingResults(results) {
  const container = document.getElementById('following-results');

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:16px 8px">
        <div class="emoji">😕</div>
        <p>No se pudo analizar ninguna cuenta (puede que sean privadas o que IG haya bloqueado las pestañas).</p>
      </div>`;
    return;
  }

  const formatNum = n => {
    if (!n) return '0';
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n/1000).toFixed(1) + 'K';
    return n.toString();
  };

  const sorted = [...results].sort((a, b) => b.score - a.score);

  container.innerHTML = `
    <div class="section-title" style="margin-top:14px">Mejores prospectos entre sus seguidos (${results.length} analizados)</div>
    <div class="prospectos-list scrollable">
      ${sorted.map(p => `
        <div class="prospecto-item" data-username="${p.username}">
          <div class="prospecto-avatar">👤</div>
          <div class="prospecto-info">
            <div class="prospecto-username">@${p.username}</div>
            <div class="prospecto-meta">
              ${formatNum(p.followers)} seguidores · ${p.posts || 0} posts
              ${p.emailInBio ? ' · ✉️' : ''}
              ${p.externalLink ? ' · 🔗' : ''}
            </div>
          </div>
          <div class="prospecto-score" style="background:${(tierColorsGlobal[p.tier] || '#8b5cf6')}22;color:${tierColorsGlobal[p.tier] || '#8b5cf6'};border:1px solid ${(tierColorsGlobal[p.tier] || '#8b5cf6')}44">
            ${p.score}
          </div>
          <div class="prospecto-actions">
            <button class="btn-icon" title="Abrir perfil" onclick="window.open('${p.profileUrl}', '_blank')">↗</button>
            <button class="btn-icon" title="Guardar como prospecto" onclick="saveFromFollowingResults('${p.username}')">⚡</button>
          </div>
        </div>
      `).join('')}
    </div>`;

  // Guardamos los resultados en memoria para poder guardarlos individualmente
  window.__followingResults = sorted;
}

// Guardar un prospecto desde la lista de "seguidos analizados"
async function saveFromFollowingResults(username) {
  const data = (window.__followingResults || []).find(p => p.username === username);
  if (!data) return;

  if (prospects.find(p => p.username === username)) {
    showToast('Ya está en tu lista ✓');
    return;
  }

  const prospect = {
    ...data,
    ratio: data.following > 0 ? (data.followers / data.following).toFixed(2) : 0,
    savedAt: new Date().toISOString()
  };

  prospects.push(prospect);
  await saveProspects();
  renderProspectsList();
  renderExportTab();
  showToast(`@${username} guardado ✓`);
}


function renderProfileResult(profile, analysis) {
  const tierColors = {
    'HOT 🔥': '#ff4545',
    'WARM ✨': '#ff8c00',
    'LUKEWARM 👀': '#f0c040',
    'COLD ❄️': '#7fb3d3'
  };
  const tierColor = tierColors[analysis.tier] || '#8b5cf6';

  const formatNum = n => {
    if (!n) return '—';
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n/1000).toFixed(1) + 'K';
    return n.toString();
  };

  const ratio = profile.following > 0
      ? (profile.followers / profile.following).toFixed(1)
      : '∞';

  const signalsHTML = analysis.signals.map(s => `
    <div class="signal ${s.type}">
      <div class="signal-dot"></div>
      <span>${s.label}</span>
    </div>
  `).join('');

  const bioShort = profile.bio
      ? profile.bio.replace(/^\d+[\w,. ]+(Followers?|Following|Posts?)[,\s]+[\d]+[\w,. ]+(Followers?|Following|Posts?)[,\s]+[\d]+[\w,.]*\s*(Followers?|Following|Posts?)[.\s]*/i, '').trim().slice(0, 180)
      : '';

  const insightMsg = getInsightMessage(profile, analysis);

  document.getElementById('analyze-content').innerHTML = `
    <div class="scrollable">
      <div class="profile-card">
        <div class="profile-header">
          <div class="profile-avatar">
            ${profile.profilePic
      ? `<img src="${profile.profilePic}" alt="avatar" onerror="this.parentNode.innerHTML='👤'" />`
      : '👤'}
          </div>
          <div class="profile-info">
            <div class="profile-username">
              @${profile.username}
              ${profile.isVerified ? '<span class="verified-badge">✓ Verificado</span>' : ''}
            </div>
            ${profile.fullName ? `<div class="profile-name">${profile.fullName}</div>` : ''}
            ${profile.category ? `<span class="profile-category">${profile.category}</span>` : ''}
          </div>
        </div>

        <div class="stats-row">
          <div class="stat-box">
            <div class="stat-num">${formatNum(profile.followers)}</div>
            <div class="stat-label">Seguidores</div>
          </div>
          <div class="stat-box">
            <div class="stat-num">${formatNum(profile.following)}</div>
            <div class="stat-label">Siguiendo</div>
          </div>
          <div class="stat-box">
            <div class="stat-num">${formatNum(profile.posts)}</div>
            <div class="stat-label">Posts</div>
          </div>
        </div>

        ${bioShort ? `
        <div class="bio-section">
          <div class="bio-text">${bioShort}</div>
          ${profile.externalLink ? `<a class="external-link" href="${profile.externalLink}" target="_blank">🔗 ${profile.externalLink.replace(/^https?:\/\//, '').slice(0, 40)}</a>` : ''}
          ${profile.emailInBio ? `<div style="font-size:11px;color:#34d399;margin-top:4px;">✉️ ${profile.emailInBio}</div>` : ''}
        </div>` : ''}
      </div>

      <div class="score-section">
        <div class="score-header">
          <span class="score-label">Score de Prospecto</span>
          <span class="score-tier" style="background:${tierColor}22;color:${tierColor};border:1px solid ${tierColor}44">${analysis.tier}</span>
        </div>
        <div class="score-bar-bg">
          <div class="score-bar-fill" style="width:${analysis.score}%"></div>
        </div>
        <div class="score-num">${analysis.score}/100 pts · Ratio ${ratio}x</div>
      </div>

      <div class="section-title">Señales detectadas</div>
      <div class="signals-list" style="margin-bottom:12px">
        ${signalsHTML}
      </div>

      ${insightMsg ? `
      <div class="insight-box">
        <div class="insight-header">✨ Insight de Growth</div>
        <div class="insight-text">${insightMsg}</div>
      </div>` : ''}

      <div class="actions">
        <button class="btn btn-primary" style="flex:1" id="btn-save-prospect">⚡ Guardar Prospecto</button>
        <button class="btn btn-secondary" id="btn-reanalyze">🔄</button>
      </div>

      <div class="actions" style="margin-top:8px">
        <button class="btn btn-secondary btn-full" id="btn-analyze-following">🚀 Analizar sus seguidos (buscar mejores prospectos)</button>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.4">
        Abre la lista de <strong>"seguidos"</strong> de @${profile.username} (haciendo clic en "following" en su perfil) y luego presiona el botón. Vamos a analizar cada cuenta y ordenarlas por potencial.
      </p>

      <div id="following-results"></div>
    </div>
  `;

  document.getElementById('btn-save-prospect').addEventListener('click', saveCurrentProspect);
  document.getElementById('btn-reanalyze').addEventListener('click', analyzeProfile);
  document.getElementById('btn-analyze-following').addEventListener('click', analyzeFollowingBatch);
}

// ─── Insight Message ─────────────────────────────────────────────────────────
function getInsightMessage(profile, analysis) {
  const f = profile.followers || 0;
  const score = analysis.score;

  if (score >= 75) {
    if (f < 10000) return `Micro-influencer con excelente ratio. Ideal para growth orgánico — suelen no tener un equipo de marketing formal aún.`;
    if (f < 50000) return `Cuenta en etapa de crecimiento activo. Momento ideal para proponer una estrategia de contenido y monetización.`;
  }
  if (score >= 55) {
    if (profile.externalLink && !profile.emailInBio) return `Tiene presencia online pero sin email público — alto potencial de contacto directo por DM.`;
    if (profile.emailInBio) return `Email en bio indica intención comercial. Contacto frío por email puede funcionar bien.`;
  }
  if (score >= 35) {
    return `Cuenta con base sólida pero sin optimizar. Oportunidad para proponer mejoras en bio, frecuencia de posteo y engagement.`;
  }
  return null;
}

// ─── Save Prospect ────────────────────────────────────────────────────────────
async function saveCurrentProspect() {
  if (!currentProfile) return;

  const exists = prospects.find(p => p.username === currentProfile.username);
  if (exists) {
    showToast('Ya está en tu lista ✓');
    return;
  }

  const prospect = {
    ...currentProfile,
    score: currentAnalysis.score,
    tier: currentAnalysis.tier,
    ratio: currentProfile.following > 0
        ? (currentProfile.followers / currentProfile.following).toFixed(2)
        : 0,
    savedAt: new Date().toISOString()
  };

  prospects.push(prospect);
  await saveProspects();
  renderProspectsList();
  renderExportTab();
  showToast(`@${prospect.username} guardado ✓`);

  const btn = document.getElementById('btn-save-prospect');
  if (btn) {
    btn.textContent = '✓ Guardado';
    btn.disabled = true;
  }
}

// ─── Render Prospects List ────────────────────────────────────────────────────
function renderProspectsList() {
  const container = document.getElementById('prospects-content');
  updateStatusCount();

  if (prospects.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🎯</div>
        <h3>Sin prospectos aún</h3>
        <p>Analiza perfiles de Instagram y guárdalos aquí para armar tu lista de outreach.</p>
      </div>`;
    return;
  }

  const tierColors = {
    'HOT 🔥': '#ff4545',
    'WARM ✨': '#ff8c00',
    'LUKEWARM 👀': '#f0c040',
    'COLD ❄️': '#7fb3d3'
  };

  const formatNum = n => {
    if (!n) return '0';
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n/1000).toFixed(1) + 'K';
    return n.toString();
  };

  const sorted = [...prospects].sort((a, b) => b.score - a.score);

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div class="section-title" style="margin-bottom:0;flex:1">Lista de prospectos</div>
      <span style="font-size:11px;color:var(--text-muted)">${prospects.length} total</span>
    </div>
    <div class="prospectos-list scrollable">
      ${sorted.map(p => `
        <div class="prospecto-item" data-username="${p.username}">
          <div class="prospecto-avatar">👤</div>
          <div class="prospecto-info">
            <div class="prospecto-username">@${p.username}</div>
            <div class="prospecto-meta">
              ${formatNum(p.followers)} seguidores · ${p.posts || 0} posts · ratio ${p.ratio}x
              ${p.emailInBio ? ' · ✉️' : ''}
              ${p.externalLink ? ' · 🔗' : ''}
            </div>
          </div>
          <div class="prospecto-score" style="background:${(tierColors[p.tier] || '#8b5cf6')}22;color:${tierColors[p.tier] || '#8b5cf6'};border:1px solid ${(tierColors[p.tier] || '#8b5cf6')}44">
            ${p.score}
          </div>
          <div class="prospecto-actions">
            <button class="btn-icon" title="Abrir perfil" onclick="window.open('${p.profileUrl}', '_blank')">↗</button>
            <button class="btn-icon" title="Eliminar" onclick="removeProspect('${p.username}')">✕</button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

// ─── Remove Prospect ──────────────────────────────────────────────────────────
async function removeProspect(username) {
  prospects = prospects.filter(p => p.username !== username);
  await saveProspects();
  renderProspectsList();
  renderExportTab();
}

// ─── Render Export Tab ────────────────────────────────────────────────────────
function renderExportTab() {
  document.getElementById('export-count').textContent = prospects.length;
  updateStatusCount();
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  if (prospects.length === 0) { showToast('Sin prospectos para exportar'); return; }

  const headers = [
    'username', 'fullName', 'followers', 'following', 'posts',
    'ratio', 'score', 'tier', 'isVerified', 'emailInBio',
    'externalLink', 'category', 'bio', 'profileUrl', 'scrapedAt', 'savedAt'
  ];

  const escapeCSV = val => {
    if (val === null || val === undefined) return '';
    const str = String(val).replace(/"/g, '""');
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
  };

  const rows = prospects.map(p => headers.map(h => escapeCSV(p[h])).join(','));
  const csv = [headers.join(','), ...rows].join('\n');

  downloadFile(csv, `ig-prospectos-${formatDate()}.csv`, 'text/csv');
  showToast(`✓ Exportados ${prospects.length} prospectos`);
}

// ─── Export JSON ──────────────────────────────────────────────────────────────
function exportJSON() {
  if (prospects.length === 0) { showToast('Sin prospectos para exportar'); return; }
  const json = JSON.stringify(prospects, null, 2);
  downloadFile(json, `ig-prospectos-${formatDate()}.json`, 'application/json');
  showToast(`✓ Exportados ${prospects.length} prospectos`);
}

// ─── Clear All ────────────────────────────────────────────────────────────────
async function clearAll() {
  if (prospects.length === 0) return;
  if (!confirm(`¿Eliminar los ${prospects.length} prospectos guardados?`)) return;
  prospects = [];
  await saveProspects();
  renderProspectsList();
  renderExportTab();
  showToast('Lista limpiada');
}

// ─── Storage ──────────────────────────────────────────────────────────────────
async function loadProspects() {
  const data = await chrome.storage.local.get('prospects');
  prospects = data.prospects || [];
}

async function saveProspects() {
  await chrome.storage.local.set({ prospects });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDate() {
  return new Date().toISOString().slice(0, 10);
}

function setStatus(msg, ok, loading = false) {
  document.getElementById('status-text').textContent = msg;
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot' + (loading ? ' loading' : ok === true ? ' active' : '');
}

function updateStatusCount() {
  document.getElementById('prospects-count').textContent = `${prospects.length} prospectos`;
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:40px;left:50%;transform:translateX(-50%);
    background:#1c1c26;border:1px solid #8b5cf6;color:#e8e8f0;
    padding:7px 16px;border-radius:20px;font-size:12px;font-weight:600;
    z-index:9999;white-space:nowrap;box-shadow:0 0 12px rgba(139,92,246,0.4)
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}