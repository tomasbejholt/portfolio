(() => {
  const API = 'https://portfolio-wivy.onrender.com';

  const isOwner = !!localStorage.getItem('_owner');

  function getToken() { return sessionStorage.getItem('_dash_token'); }

  // ── Spårning – körs bara för riktiga besökare ─────────────────────────────
  if (!isOwner) {
    function getVisitorId() {
      let id = localStorage.getItem('_vid');
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
        localStorage.setItem('_vid', id);
      }
      return id;
    }

    const visitorId = getVisitorId();
    const page = document.title.includes('Projects') ? 'projects'
               : document.title.includes('About')    ? 'about'
               : 'home';

    function track(event, data) {
      fetch(`${API}/api/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: visitorId, page, event, data: data || null }),
      }).catch(() => {});
    }

    track('pageview');

    document.addEventListener('click', e => {
      const t = e.target.closest('[data-project], #cw-bubble, #start-btn, #gtl-plan-btn');
      if (!t) return;
      if (t.dataset.project)          track('project_click', t.dataset.project);
      else if (t.id === 'cw-bubble')  track('chat_open');
      else if (t.id === 'start-btn')  track('snake_start');
      else if (t.id === 'gtl-plan-btn') track('dayplan_use');
    });
  }

  // ── 5-click dashboard trigger ─────────────────────────────────────────────
  const trigger = document.getElementById('analytics-trigger');
  if (!trigger) return;

  let clicks = 0;
  let timer = null;

  trigger.addEventListener('click', () => {
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 3000);
    if (clicks >= 5) {
      clicks = 0;
      clearTimeout(timer);
      if (getToken()) { openDashboard(); return; }
      showPinModal();
    }
  });

  // ── PIN-modal ─────────────────────────────────────────────────────────────
  function showPinModal() {
    const overlay = document.createElement('div');
    overlay.id = 'pin-overlay';
    overlay.innerHTML = `
      <div class="an-panel" style="max-width:320px;gap:1rem;">
        <h2 class="an-title">Dashboard</h2>
        <input id="pin-input" type="password" placeholder="PIN" autocomplete="off"
          style="width:100%;padding:.6rem .8rem;background:#1a1a2e;border:1px solid #333;border-radius:6px;color:#e0e0e0;font-size:1rem;outline:none;">
        <button id="pin-submit"
          style="width:100%;padding:.6rem;background:#7c3aed;border:none;border-radius:6px;color:#fff;font-size:.95rem;cursor:pointer;">
          Logga in
        </button>
        <p id="pin-error" style="color:#f87171;font-size:.85rem;text-align:center;display:none;">Fel PIN</p>
      </div>`;
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
    document.body.appendChild(overlay);

    const input = document.getElementById('pin-input');
    input.focus();

    function tryLogin() {
      const pin = input.value;
      if (!pin) return;
      fetch(`${API}/api/analytics/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      }).then(r => r.json()).then(res => {
        if (res.token) {
          sessionStorage.setItem('_dash_token', res.token);
          localStorage.setItem('_owner', '1');
          overlay.remove();
          openDashboard();
        } else {
          document.getElementById('pin-error').style.display = 'block';
          input.value = '';
          input.focus();
        }
      }).catch(() => {});
    }

    document.getElementById('pin-submit').addEventListener('click', tryLogin);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  function openDashboard() {
    const existing = document.getElementById('analytics-overlay');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'analytics-overlay';
    overlay.innerHTML = `
      <div class="an-panel">
        <button class="an-close" id="an-close">✕</button>
        <h2 class="an-title">Dashboard</h2>
        <div id="an-body" class="an-loading">Laddar...</div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('an-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    fetch(`${API}/api/analytics?key=${getToken()}`)
      .then(r => r.json())
      .then(renderDashboard)
      .catch(() => {
        document.getElementById('an-body').textContent = 'Kunde inte hämta data.';
      });
  }

  function eventLabel(e, pageLabels) {
    if (e.event === 'pageview')      return `📄 ${pageLabels[e.page] || e.page}`;
    if (e.event === 'project_click') return `🖱️ ${e.data}`;
    if (e.event === 'chat_open')     return '💬 Öppnade chatten';
    if (e.event === 'snake_start')   return '🐍 Spelade Snake';
    if (e.event === 'dayplan_use')   return '🗺️ Planerade dag';
    return e.event;
  }

  function renderDashboard(d) {
    const pageLabels = { home: 'Home', projects: 'Projects', about: 'About' };
    const allEvents  = d.recent || [];

    // ── Statistik ──
    const pageViewRows = Object.entries(d.page_views || {})
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `<tr><td>${pageLabels[p] || p}</td><td class="an-num">${n}</td></tr>`)
      .join('') || '<tr><td colspan="2">Inga data</td></tr>';

    const projectRows = Object.entries(d.project_clicks || {})
      .sort((a, b) => b[1] - a[1])
      .map(([proj, n]) => `<tr><td>${proj}</td><td class="an-num">${n}</td></tr>`)
      .join('') || '<tr><td colspan="2">Inga klick ännu</td></tr>';

    // ── Besökarresor – gruppera per visitor_id ──
    const byVisitor = {};
    [...allEvents].reverse().forEach(e => {
      if (!byVisitor[e.visitor_id]) byVisitor[e.visitor_id] = [];
      byVisitor[e.visitor_id].push(e);
    });

    const journeyRows = Object.entries(byVisitor)
      .sort((a, b) => {
        const firstA = new Date(a[1][0].created_at).getTime();
        const firstB = new Date(b[1][0].created_at).getTime();
        return firstB - firstA;
      })
      .map(([vid, events], i) => {
        const first = new Date(events[0].created_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
        const visitCount = events.filter(e => e.event === 'pageview').length;
        const steps = events.map(e => `<span class="an-step">${eventLabel(e, pageLabels)}</span>`).join('<span class="an-arrow">→</span>');
        const rowId = `journey-${i}`;
        return `
          <div class="an-journey" onclick="
            const d = document.getElementById('${rowId}');
            const a = this.querySelector('.an-journey-arrow');
            d.style.display = d.style.display === 'none' ? 'flex' : 'none';
            a.textContent = d.style.display === 'none' ? '▶' : '▼';
          ">
            <div class="an-journey-meta">
              <span class="an-journey-arrow">▶</span>
              <span class="an-vid">${vid.slice(0, 8)}</span>
              <span class="an-journey-time">${first}</span>
              <span class="an-journey-count">${visitCount} besök · ${events.length} events</span>
              <button class="an-block-btn" data-vid="${vid}" title="Blockera besökare">🚫</button>
            </div>
            <div class="an-journey-steps" id="${rowId}" style="display:none">${steps}</div>
          </div>`;
      }).join('') || '<p class="an-empty">Inga besök ännu</p>';

    const body = document.getElementById('an-body');
    body.innerHTML = `
      <div class="an-stat-row">
        <div class="an-stat">
          <span class="an-stat-num">${d.total_visits ?? 0}</span>
          <span class="an-stat-label">Totalt besök</span>
        </div>
        <div class="an-stat">
          <span class="an-stat-num">${d.unique_visitors}</span>
          <span class="an-stat-label">Unika besökare</span>
        </div>
        <div class="an-stat">
          <span class="an-stat-num">${Object.values(d.page_views || {}).reduce((a, b) => a + b, 0)}</span>
          <span class="an-stat-label">Sidvisningar</span>
        </div>
        <div class="an-stat">
          <span class="an-stat-num">${Object.values(d.project_clicks || {}).reduce((a, b) => a + b, 0)}</span>
          <span class="an-stat-label">Projektklick</span>
        </div>
      </div>

      <h3 class="an-section-title">Sidvisningar</h3>
      <table class="an-table"><thead><tr><th>Sida</th><th>Visningar</th></tr></thead>
      <tbody>${pageViewRows}</tbody></table>

      <h3 class="an-section-title">Mest klickade projekt</h3>
      <table class="an-table"><thead><tr><th>Projekt</th><th>Klick</th></tr></thead>
      <tbody>${projectRows}</tbody></table>

      <h3 class="an-section-title">Besökarresor</h3>
      ${journeyRows}`;

    body.addEventListener('click', e => {
      const btn = e.target.closest('.an-block-btn');
      if (!btn) return;
      e.stopPropagation();
      const vid = btn.dataset.vid;
      fetch(`${API}/api/analytics/block?key=${getToken()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: vid }),
      }).then(r => r.json()).then(res => {
        if (res.ok) {
          fetch(`${API}/api/analytics?key=${getToken()}`)
            .then(r => r.json())
            .then(renderDashboard)
            .catch(() => {});
        }
      }).catch(() => {});
    }, { once: true });
  }
})();
