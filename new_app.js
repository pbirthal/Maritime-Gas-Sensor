/* ========== Utilities ========== */
function $(q, root=document){ return root.querySelector(q); }
function $all(q, root=document){ return [...root.querySelectorAll(q)]; }
function now(){ return new Date(); }
// ---- Theme toggle (persisted) ----
(function initTheme(){
  const saved = localStorage.getItem('theme') || 'light';
  if (saved === 'dark') document.body.classList.add('theme-dark');
  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.onclick = () => {
      document.body.classList.toggle('theme-dark');
      const isDark = document.body.classList.contains('theme-dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    };
  });
})();

function initClock(id){
  const el = document.getElementById(id);
  const tick = ()=> el && (el.textContent = now().toLocaleTimeString());
  tick(); setInterval(tick, 1000);
}

/* Interaction guard to avoid heavy re-render while user is clicking/typing */
let __interacting = false;
let __interactionTimer = null;
function markInteracting() {
  __interacting = true;
  clearTimeout(__interactionTimer);
  __interactionTimer = setTimeout(() => { __interacting = false; }, 2500);
}
['mousedown','keydown','touchstart'].forEach(evt => {
  window.addEventListener(evt, markInteracting, {passive:true});
});

/* ================= GLOBAL ALARM CENTER (front-end only) ================= */

const ALARM = (() => {
  // config
  const POLL_MS = 5000;
  const STAGE_WINDOW_MS = 30000; // 30s per stage
  const SELECTOR_MARQUEE = '#emergencyMarquee';

  // state
  let polling = null;
  let stageTimer = null;
  let countdownTimer = null;

  // active incident (simple key per ship:tank)
  let active = null; // { ship_id, tank_id, stage:0|1|2, deadline:number }

  // Create modal once for all pages
  function ensureModal() {
    if (document.getElementById('globalAlarmModal')) return;

    const wrap = document.createElement('div');
    wrap.id = 'globalAlarmModal';
    wrap.className = 'modal hidden';
    wrap.innerHTML = `
      <div class="modal-card">
        <h3 id="gaTitle">Danger Alarm</h3>
        <p id="gaText" style="margin-top:6px;"></p>
        <div class="stat-title" id="gaCountdown" style="margin-top:6px;">Respond within <strong>30</strong>s</div>
        <div class="modal-actions">
          <button class="btn" id="gaDismiss">Acknowledge</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  function showModal(title, text, seconds=30) {
    ensureModal();
    $('#gaTitle').textContent = title;
    $('#gaText').textContent = text;
    $('#gaCountdown').innerHTML = `Respond within <strong>${seconds}</strong>s`;
    $('#globalAlarmModal').classList.remove('hidden');
  }
  function hideModal() {
    const el = $('#globalAlarmModal');
    if (el) el.classList.add('hidden');
  }

  // emergency UI hook (reuses your existing helpers if present)
  function activateEmergencyUI(on) {
    if (typeof setEmergencyUI === 'function') {
      setEmergencyUI(on);
    } else {
      document.body.classList.toggle('emergency-active', !!on);
      const mq = document.querySelector(SELECTOR_MARQUEE);
      if (mq) mq.classList.toggle('hidden', !on);
    }
  }

  // thresholds check (Danger only; no readings shown to user)
  function isDanger(worst, thr) {
    if (!worst || !thr) return false;
    if (worst.O2 != null && thr.danger_o2_low != null && worst.O2 <= thr.danger_o2_low) return true;
    if (worst.CO != null && thr.danger_co_high != null && worst.CO >= thr.danger_co_high) return true;
    if (worst.LEL != null && thr.danger_lel_high != null && worst.LEL >= thr.danger_lel_high) return true;
    if (worst.H2S != null && thr.danger_h2s_high != null && worst.H2S >= thr.danger_h2s_high) return true;
    return false;
  }

  // countdown handling
  function startStage(stage) {
    // stage: 0 = initial Danger, 1 = “warning sent to authority”, 2 = raise emergency
    const now = Date.now();
    const deadline = now + STAGE_WINDOW_MS;
    active.stage = stage;
    active.deadline = deadline;

    // update UI text
    if (stage === 0) {
      showModal('Danger Alarm',
        `Danger threshold reached on Ship ${active.ship_id}, Tank ${active.tank_id}. Please acknowledge.`, 30);
    } else if (stage === 1) {
      showModal('Escalation',
        `No response. A warning has been sent to the responsible authority for Ship ${active.ship_id}, Tank ${active.tank_id}. Please acknowledge to stop escalation.`,
        30);
    } else if (stage === 2) {
      // final escalation: raise emergency
      hideModal();
      activateEmergencyUI(true);
      // Show a brief toast if your app has one
      if (typeof showToast === 'function') showToast('🚨 Emergency auto-raised due to no acknowledgment');
      return; // no countdown needed past this point
    }

    // countdown display
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      const secs = Math.max(0, Math.ceil((active.deadline - Date.now()) / 1000));
      $('#gaCountdown').innerHTML = `Respond within <strong>${secs}</strong>s`;
      if (secs <= 0) {
        clearInterval(countdownTimer);
        // escalate to next stage
        if (active && active.stage === 0) startStage(1);
        else if (active && active.stage === 1) startStage(2);
      }
    }, 250);
  }

  // acknowledge handler
  async function acknowledge() {
    // clear UI + timers
    hideModal();
    clearInterval(countdownTimer);
    // return to normal visual state
    activateEmergencyUI(false);

    // remember we acknowledged this incident so we don’t re-prompt immediately
    if (active) {
      localStorage.setItem(`ack:${active.ship_id}:${active.tank_id}`, String(Date.now()));
      // Try to clear sticky danger on that ship (optional; best effort)
      try {
        await fetch(`${API_BASE_URL}/api/ships/${encodeURIComponent(active.ship_id)}/acknowledge`, { method: 'PUT' });
      } catch {}
    }
    active = null;
  }

  function wireAcknowledgeButton() {
    ensureModal();
    const btn = $('#gaDismiss');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', acknowledge);
    }
  }

  // core polling loop
  async function poll() {
    try {
      // if an alarm is active (stage 0/1 in progress), let it finish escalation unless acknowledged
      if (active && active.stage < 2) return;

      // fetch ships with nested tanks
      const res = await fetch(`${API_BASE_URL}/api/ships`);
      const ships = await res.json();
      if (!Array.isArray(ships)) return;

      for (const s of ships) {
        // if we already acked this ship+tank recently (e.g., last 2 minutes), skip re-prompting
        const tanks = (s.tanks || []);
        for (const t of tanks) {
          const ackKey = `ack:${s.id}:${t.id}`;
          const lastAck = parseInt(localStorage.getItem(ackKey) || '0', 10);
          if (Date.now() - lastAck < 120000) continue; // 2 min cool-down after ack

          // get live + thresholds; decide Danger
          const [liveRes, thrRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/ships/${encodeURIComponent(s.id)}/tanks/${t.id}/live`),
            fetch(`${API_BASE_URL}/api/ships/${encodeURIComponent(s.id)}/tanks/${t.id}/thresholds`)
          ]);
          const live = await liveRes.json();
          const thr  = await thrRes.json();
          const worst = (live && live.aggregates && live.aggregates.worst) ? live.aggregates.worst : null;

          if (isDanger(worst, thr)) {
            // start a new incident
            active = { ship_id: s.id, tank_id: t.id, stage: 0, deadline: 0 };
            wireAcknowledgeButton();
            startStage(0);
            return; // handle one at a time
          }
        }
      }
    } catch (e) {
      // ignore network errors; keep polling
    }
  }

  function start() {
    // inject modal + wire acknowledge
    ensureModal();
    wireAcknowledgeButton();

    // begin polling
    clearInterval(polling);
    polling = setInterval(poll, POLL_MS);
    // also do an immediate check on load
    poll();
  }

  return { start, acknowledge };
})();

// Start the alarm center when the app loads (once)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ALARM.start());
} else {
  ALARM.start();
}

/* ========== Toasts ========== */
let __toastBox = null;
function ensureToastBox(){
  if (!__toastBox){
    __toastBox = document.createElement('div');
    __toastBox.id = 'toastBox';
    document.body.appendChild(__toastBox);
  }
}
function showToast(msg){
  ensureToastBox();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  __toastBox.appendChild(t);
  setTimeout(()=>{ t.classList.add('show'); }, 10);
  setTimeout(()=>{
    t.classList.remove('show');
    t.addEventListener('transitionend', ()=> t.remove(), {once:true});
  }, 2200);
}

/* ========== API & Data Handling ========== */
const API_BASE_URL = ''; // Use empty string for relative paths
let SHIPS_CACHE = [];
let SENSORS_CACHE = [];
let TANK_TYPES_CACHE = [];

// --- NEW ---
let EXTERNAL_READINGS_CACHE = [];
let liveReadingIndex = 0; // Index to cycle through the cached readings

// --- NEW: This function fetches from the external API ---
async function fetchAndCacheExternalReadings() {
  try {
    const response = await fetch('https://api.neuronwise.in/nw-ui/sensor_readings');
    if (!response.ok) throw new Error('Failed to fetch external readings');
    const data = await response.json();
    // Sort by timestamp to ensure chronological order for simulation
    EXTERNAL_READINGS_CACHE = data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    console.log(`Cached and sorted ${EXTERNAL_READINGS_CACHE.length} external readings.`);
  } catch (error) {
    console.error("Error fetching external data:", error);
  }
}

async function fetchMasterData() {
  try {
    const [shipsRes, sensorsRes, tankTypesRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/ships`),
      fetch(`${API_BASE_URL}/api/master/sensors`),
      fetch(`${API_BASE_URL}/api/master/tank-types`)
    ]);
    SHIPS_CACHE = await shipsRes.json();
    SENSORS_CACHE = await sensorsRes.json();
    TANK_TYPES_CACHE = await tankTypesRes.json();
  } catch (error) {
    console.error("Failed to fetch master data:", error);
  }
}

function startRealtimeUpdates() {
  fetchMasterData().then(() => {
    if (document.getElementById('shipsList')) renderOverviewPage(SHIPS_CACHE);
  });
  setInterval(async () => {
    await fetchMasterData();
    if (document.getElementById('shipsList')) {
      if (__interacting) {
        // gentle mode: only update counters
        $('#shipsAtDock').textContent = SHIPS_CACHE.length.toString();
        $('#shipsUnderOp').textContent = SHIPS_CACHE.filter(s=>s.status==='WIP').length;
        $('#totalPersonnel').textContent = SHIPS_CACHE.reduce((a,s)=>a+s.personnel,0);
        $('#spacesDanger').textContent = SHIPS_CACHE.filter(s=>s.status==='Danger').length;
        $('#spacesWarn').textContent   = SHIPS_CACHE.filter(s=>s.status === 'Warning').length;
      } else {
        renderOverviewPage(SHIPS_CACHE);
      }
    }
  }, 3000);
}

/* ========== Page 1 (Overview) ========== */
function initOverview(){
  renderOverviewPage([]);
  setupOverviewEventListeners();
  startRealtimeUpdates();
}

// Stable pseudo-random from string (so dummy hours don't change every render)
function seedFromString(str){
  let h = 2166136261 >>> 0; // FNV-1a base
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededInt(seed, min, max){
  // xorshift32
  let x = seed || 123456789;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  const u = ((x >>> 0) / 0xFFFFFFFF);
  return Math.floor(min + u * (max - min + 1));
}

// Build rows for the Work Summary table
function renderWorkSummaryTable(ships){
  const tb = document.getElementById('workSummaryBody');
  if (!tb) return;

  if (!Array.isArray(ships) || ships.length === 0){
    tb.innerHTML = `<tr><td colspan="4">No ships available.</td></tr>`;
    return;
  }

  // fixed dummy threshold (hours)
  const THRESH = 8;

  tb.innerHTML = ships.map(s => {
    const seed = seedFromString(String(s.id ?? s.name ?? 'ship'));
    const hours = seededInt(seed, 3, 12); // dummy 3..12 h
    const rowClass = hours > THRESH ? 'exceed' : '';
    const personnel = (typeof s.personnel === 'number') ? s.personnel : '—';
    const shipName  = s.name ?? s.id ?? '—';
    return `
      <tr class="${rowClass}">
        <td>${shipName}</td>
        <td>${personnel}</td>
        <td>${hours} h</td>
        <td>${THRESH} h</td>
      </tr>`;
  }).join('');
}

function renderOverviewPage(ships){
  $('#shipsAtDock').textContent = ships.length.toString();
  $('#shipsUnderOp').textContent = ships.filter(s=>s.status==='WIP').length;
  $('#totalPersonnel').textContent = ships.reduce((a,s)=>a+s.personnel,0);
  $('#spacesDanger').textContent = ships.filter(s=>s.status==='Danger').length;
  $('#spacesWarn').textContent = ships.filter(s => s.status === 'Warning').length;

  const row = $('#shipsRow');
  if (row) {
    row.innerHTML = '';
    ships.forEach(ship => {
      const card = document.createElement('div');
      card.className = 'ship-status';
      const statusLabel = ship.status === 'Danger' ? 'In Danger' : ship.status;
      const shipIconHTML = ship.image ? `<img src="${ship.image}" alt="${ship.name}">` : '🚢';
      card.innerHTML = `
        <div class="ship-icon">${shipIconHTML}</div>
        <div class="ship-status-name" title="${ship.name}">${ship.name}</div>
        <div class="badge ${badgeFor(ship.status)}">${statusLabel}</div>
      `;
      row.appendChild(card);
    });

    const addBtn = document.createElement('div');
    addBtn.className = 'ship-status-add';
    addBtn.id = 'addShipBtn';
    addBtn.title = 'Add New Ship';
    addBtn.innerHTML = `<div class="add-icon">+</div>`;
    row.appendChild(addBtn);
  }

  const list = $('#shipsList');
  if (list) {
    list.innerHTML = '';
    ships.forEach(ship=>{
      const el = document.createElement('div');
      el.className = 'shipcard';
      el.dataset.shipId = ship.id;
      const isDanger = ship.status === 'Danger';
      el.innerHTML = `
        <div>
          <button type="button" class="btn-delete" title="Delete Ship">X</button>
          <div class="shipmeta">
            <div class="shipname">${ship.name}</div>
            <div>Last Port: ${ship.lastPort}</div>
            <div>Arrived: ${ship.arrived}</div>
            <div>Status: <span class="badge ${badgeFor(ship.status)}">${ship.status}</span></div>
          </div>
        </div>
        <div class="ship-actions">
          <div class="status-button-group">
            <button type="button" class="btn-status ${ship.status === 'Idle' ? 'active' : ''}" data-status="Idle" ${isDanger ? 'disabled' : ''}>IDLE</button>
            <button type="button" class="btn-status ${ship.status === 'WIP' ? 'active' : ''}" data-status="WIP" ${isDanger ? 'disabled' : ''}>WIP</button>
          </div>
          <button type="button" class="btn-edit">Edit</button>
          <a class="btn enter" href="ship.html?ship=${encodeURIComponent(ship.id)}">ENTER</a>
        </div>
      `;
      list.appendChild(el);
    });
  }
  renderWorkSummaryTable(ships);
}

function setupOverviewEventListeners(){

  // ---------- Emergency Alarm wiring (raise + clear) ----------
  const emModal   = $('#emergencyModal');
  const emBtn     = $('#btnEmergency');
  const emMarq    = $('#emergencyMarquee');
  const emClear   = $('#btnClearEmergency');
  const emClrModal= $('#clearEmergencyModal');

  function setEmergencyUI(active){
    // Page flash + marquee
    document.body.classList.toggle('emergency-active', !!active);
    if (emMarq) emMarq.classList.toggle('hidden', !active);

    // Buttons: when active, show "Clear"; when inactive, show "Raise"
    if (emBtn) {
      emBtn.textContent = active ? 'EMERGENCY ACTIVE' : 'RAISE EMERGENCY ALARM';
      emBtn.classList.toggle('btn-danger', !active);
      emBtn.classList.toggle('btn-confirm', !!active);
      emBtn.disabled = active ? true : false; // lock raise while active
    }
    if (emClear) emClear.classList.toggle('hidden', !active);
  }

  // OPEN raise modal
  if (emBtn && emModal){
    emBtn.addEventListener('click', () => { emModal.classList.remove('hidden'); });
    $('#cancelEm') && ($('#cancelEm').onclick = () => emModal.classList.add('hidden'));
    $('#confirmEm') && ($('#confirmEm').onclick = async () => {
      emModal.classList.add('hidden');
      setEmergencyUI(true);
      showToast('🚨 Emergency alarm raised');
      pushLog('🚨 Emergency alarm raised at dockyard.');

      try {
        await fetch(`${API_BASE_URL}/api/logs`, {
          method:'POST',
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({event:'Emergency', details:'Dockyard emergency raised from UI'})
        });
      } catch {}
    });
  }

  // OPEN clear modal
  if (emClear && emClrModal){
    emClear.addEventListener('click', () => emClrModal.classList.remove('hidden'));
    $('#cancelClearEm') && ($('#cancelClearEm').onclick = () => emClrModal.classList.add('hidden'));
    $('#confirmClearEm') && ($('#confirmClearEm').onclick = async () => {
      emClrModal.classList.add('hidden');
      setEmergencyUI(false);
      showToast('✅ Emergency cleared');
      pushLog('✅ Emergency cleared from UI.');

      try {
        await fetch(`${API_BASE_URL}/api/logs`, {
          method:'POST',
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({event:'EmergencyClear', details:'Dockyard emergency cleared from UI'})
        });
      } catch {}
    });
  }

  const addModal = $('#addShipModal');
  document.addEventListener('click', e => {
    if (e.target.closest('#addShipBtn')) {
      addModal.classList.remove('hidden');
    }
  });
  $('#cancelAddShip') && ($('#cancelAddShip').onclick = () => addModal.classList.add('hidden'));
  $('#addShipForm') && ($('#addShipForm').onsubmit = async (e) => {
    e.preventDefault();
    const newShipData = {
      name: $('#newShipName').value,
      lastPort: $('#newShipPort').value,
      personnel: parseInt($('#newShipPersonnel').value, 10),
      status: 'Idle'
    };
    try {
      const response = await fetch(`${API_BASE_URL}/api/ships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newShipData)
      });
      if (!response.ok) throw new Error('Failed to create ship.');
      await fetchMasterData();
      renderOverviewPage(SHIPS_CACHE);
      addModal.classList.add('hidden');
      e.target.reset();
      showToast('Ship added');
      // optional audit
      fetch(`${API_BASE_URL}/api/logs`, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({event:'add_ship', details:`[ship ${newShipData.name}] created from UI`})
      }).catch(()=>{});
    } catch (error) {
      console.error("Error creating ship:", error);
      alert("Error: Could not create ship. Check if the ID is unique.");
    }
  });

  const editModal = $('#editShipModal');
  $('#cancelEditShip') && ($('#cancelEditShip').onclick = () => editModal.classList.add('hidden'));
  $('#editShipForm') && ($('#editShipForm').onsubmit = async (e) => {
    e.preventDefault();
    const shipId = $('#editShipId').value;
    const ship = SHIPS_CACHE.find(s => s.id === shipId);
    if (!ship) return;
    const updatedShipData = {
      name: $('#editShipName').value,
      lastPort: $('#editShipPort').value,
      personnel: parseInt($('#editShipPersonnel').value, 10),
      status: ship.status
    };
    try {
      const response = await fetch(`${API_BASE_URL}/api/ships/${shipId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedShipData)
      });
      if (!response.ok) throw new Error('Failed to update ship.');
      await fetchMasterData();
      renderOverviewPage(SHIPS_CACHE);
      editModal.classList.add('hidden');
      showToast('Ship updated');
      fetch(`${API_BASE_URL}/api/logs`, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({event:'edit_ship', details:`[ship ${shipId}] details updated`})
      }).catch(()=>{});
    } catch (error) {
      console.error("Error updating ship:", error);
    }
  });

  $('#shipsList') && $('#shipsList').addEventListener('click', async (e) => {
    const card = e.target.closest('.shipcard');
    if (!card) return;
    const shipId = card.dataset.shipId;
    const ship = SHIPS_CACHE.find(s => s.id === shipId);
    if (!ship) return;

    if (e.target.classList.contains('btn-delete')) {
      if (confirm(`Delete ship: ${ship.name}?`)) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/ships/${shipId}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('Failed to delete ship.');
          await fetchMasterData();
          renderOverviewPage(SHIPS_CACHE);
          showToast('Ship deleted');
          fetch(`${API_BASE_URL}/api/logs`, {
            method:'POST',
            headers:{'Content-Type':'application/x-www-form-urlencoded'},
            body:new URLSearchParams({event:'delete_ship', details:`[ship ${shipId}] deleted`})
          }).catch(()=>{});
        } catch (error) {
          console.error("Error deleting ship:", error);
        }
      }
    }

    if (e.target.classList.contains('btn-edit')) {
      $('#editShipId').value = ship.id;
      $('#editShipName').value = ship.name;
      $('#editShipPort').value = ship.lastPort;
      $('#editShipPersonnel').value = ship.personnel;
      editModal.classList.remove('hidden');
    }

    if (e.target.classList.contains('btn-status')) {
      const newStatus = e.target.dataset.status;
      const shipUpdateData = { ...ship, status: newStatus };
      try {
        const response = await fetch(`${API_BASE_URL}/api/ships/${shipId}`, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(shipUpdateData)
        });
        if (!response.ok) throw new Error('Failed to update status');
        await fetchMasterData();
        renderOverviewPage(SHIPS_CACHE);
        showToast(`Status → ${newStatus}`);
        fetch(`${API_BASE_URL}/api/logs`, {
          method:'POST',
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({event:'status_change', details:`[ship ${shipId}] status set to ${newStatus}`})
        }).catch(()=>{});
      } catch (error) {
        console.error("Error updating ship status:", error);
      }
    }
  });
}

function badgeFor(s){
  if(s==='Danger') return 'danger';
  if(s==='WIP') return 'ok';
  if(s==='Warning') return 'warn';
  return 'gray';
}

/* ========== Page 2 (Ship details) ========== */
let currentShip = null;        // GLOBAL
let currentTankId = null;      // GLOBAL
let CURRENT_THRESHOLDS = null; // GLOBAL thresholds for current tank

/* ---- thresholds helpers ---- */
async function fetchTankThresholds(shipId, tankId) {
  const res = await fetch(`${API_BASE_URL}/api/ships/${shipId}/tanks/${tankId}/thresholds`);
  if (!res.ok) throw new Error(`threshold fetch failed ${res.status}`);
  return await res.json();
}

/* ---- LIVE tank snapshot (multi-sensor) ----
   { updated_at, sensors: {S1:{O2,CO,LEL}, ...},
     aggregates: { display:{O2,CO,LEL}, worst:{O2,CO,LEL} } } */
async function fetchTankLive(shipId, tankId) {
  const res = await fetch(`${API_BASE_URL}/api/ships/${shipId}/tanks/${tankId}/live`);
  if (!res.ok) throw new Error('live fetch failed');
  return await res.json();
}

function showThresholdsText(T) {
  const el = document.getElementById('thresholdInfo');
  if (!el) return;
  el.innerHTML = `
    <div class="thr-wrap">
      <div class="thr-chip o2">
        <strong>O₂</strong>
        <span class="mini">warn ≤</span> <span class="val">${T.warn_o2_low}%</span>
        <span class="mini">danger ≤</span> <span class="val">${T.danger_o2_low}%</span>
      </div>
      <div class="thr-chip co">
        <strong>CO</strong>
        <span class="mini">warn ≥</span> <span class="val">${T.warn_co_high} ppm</span>
        <span class="mini">danger ≥</span> <span class="val">${T.danger_co_high} ppm</span>
      </div>
      <div class="thr-chip lel">
        <strong>LEL</strong>
        <span class="mini">warn ≥</span> <span class="val">${T.warn_lel_high}%</span>
        <span class="mini">danger ≥</span> <span class="val">${T.danger_lel_high}%</span>
      </div>
      <div class="thr-chip h2s">
        <strong>H2S</strong>
        <span class="mini">warn ≥</span> <span class="val">${T.warn_h2s_high}%</span>
        <span class="mini">danger ≥</span> <span class="val">${T.danger_h2s_high}%</span>
      </div>
    </div>
  `;
}

function setKPIState(id, value, warn, danger, isLow=false) {
  const el = document.getElementById(id);
  if (!el) return;
  const kpi = el.closest('.kpi');
  if (!kpi) return;
  kpi.classList.remove('ok','warn','danger');
  let state = 'ok';
  if (value !== null && value !== undefined) {
    if ((isLow && value <= danger) || (!isLow && value >= danger)) state = 'danger';
    else if ((isLow && value <= warn) || (!isLow && value >= warn)) state = 'warn';
  }
  kpi.classList.add(state);
}

/* Write KPI numbers and apply CURRENT_THRESHOLDS (or defaults) */
function renderShipKPIsWithThresholds(ship) {
  const fmt = v => (v === null || v === undefined) ? '—' : parseFloat(v).toFixed(1);
  $('#kpiO2')  && ($('#kpiO2').textContent  = fmt(ship.live_o2));
  $('#kpiCO')  && ($('#kpiCO').textContent  = fmt(ship.live_co));
  $('#kpiLEL') && ($('#kpiLEL').textContent = fmt(ship.live_lel));
  $('#kpiH2S') && ($('#kpiH2S').textContent = fmt(ship.live_h2s));

  const T = CURRENT_THRESHOLDS || {
    warn_o2_low:19.5, danger_o2_low:18,
    warn_co_high:35,  danger_co_high:100,
    warn_lel_high:5,  danger_lel_high:10,
    warn_h2s_high:5,  danger_h2s_high:10
  };
  setKPIState('kpiO2',  ship.live_o2,  T.warn_o2_low,  T.danger_o2_low,  true);
  setKPIState('kpiCO',  ship.live_co,  T.warn_co_high, T.danger_co_high, false);
  setKPIState('kpiLEL', ship.live_lel, T.warn_lel_high,T.danger_lel_high,false);
  setKPIState('kpiH2S', ship.live_h2s, T.warn_h2s_high,T.danger_h2s_high,false);
}

/* Render live sensor tiles for the selected tank */
function renderTankSensorsLiveMapToTiles(sensorsMap) {
  const entries = Object.entries(sensorsMap || {}); // [[id,{O2,CO,LEL,H2S}], ...]
  if (entries.length === 0) {
    return '<p>No live sensors reporting for this tank.</p>';
  }
  return entries.map(([sid, vals]) => {
    // lookup inventory record to get battery% if available
    const inv = (SENSORS_CACHE || []).find(s => s.id === sid) || {};
    const batteryPct = inv.battery ?? '—';
    // naive signal: show 3/5 if we have live data; you can wire a real RSSI if available
    const strength =  vals ? 3 : 1;  // 1..5
    const o2  = (vals.O2  ?? '—');
    const co  = (vals.CO  ?? '—');
    const lel = (vals.LEL ?? '—');
    const h2s = (vals.H2S ?? '—');

    // battery fill level for CSS (0..1)
    const batLevel = (typeof batteryPct === 'number') ? Math.max(0, Math.min(1, batteryPct/100)) : 0.5;

    return `
      <div class="sensor" data-sensor-id="${sid}">
        <button class="sensor-remove" title="Unassign / Remove">×</button>

        <div class="sensor-top">
          <div class="sensor-id">${sid}</div>
        </div>

        <div class="sensor-val">O₂: <strong>${o2}</strong>%</div>
        <div class="sensor-val">CO: <strong>${co}</strong> ppm</div>
        <div class="sensor-val">LEL: <strong>${lel}</strong>%</div>
        <div class="sensor-val">H2S: <strong>${h2s}</strong> ppm</div>

        <div class="sensor-meta">
          <span class="battery" title="Battery">
            <span class="bat-icon"><span class="bat-fill" style="--level:${batLevel}"></span></span>
            <span>${batteryPct}%</span>
          </span>
          <span class="signal" title="Network" data-strength="${strength}">
            <span class="sig-bar"></span><span class="sig-bar"></span><span class="sig-bar"></span><span class="sig-bar"></span><span class="sig-bar"></span>
          </span>
        </div>
      </div>
    `;
  }).join('');
}


function renderTankSensorsLive(sensorsMap) {
  const wrap = $('#sensorsWrap');
  if (!wrap) return;
  wrap.innerHTML = renderTankSensorsLiveMapToTiles(sensorsMap);

  // Keep the Assign button at the end
  const assignBtn = document.createElement('button');
  assignBtn.type = 'button';
  assignBtn.className = 'btn';
  assignBtn.id = 'assignSensorBtn';
  assignBtn.textContent = '+ Assign Sensors';
  assignBtn.dataset.tankId = currentTankId;
  wrap.appendChild(assignBtn);
}

/* On tank selection:
   - fetch thresholds
   - fetch live multi-sensor snapshot
   - set ship KPIs to DISPLAY aggregate (max across sensors)
   - render sensor tiles */
async function onTankSelected(shipId, tankId) {
  try {
    CURRENT_THRESHOLDS = await fetchTankThresholds(shipId, tankId);
  } catch (e) {
    console.warn('Thresholds fetch failed, using defaults.', e);
    CURRENT_THRESHOLDS = null;
  }
  showThresholdsText(CURRENT_THRESHOLDS || {
    warn_o2_low:19.5, danger_o2_low:18,
    warn_co_high:35,  danger_co_high:100,
    warn_lel_high:5,  danger_lel_high:10,
    warn_h2s_high:10,  danger_h2s_high:15,
  });

  // This will be handled by the live data simulation poll
  renderShipKPIsWithThresholds(currentShip);
}

async function initShipPage() {
  await fetchMasterData();

  const p = new URLSearchParams(location.search);
  const shipId = p.get('ship');
  currentShip = SHIPS_CACHE.find(s => s.id === shipId); // GLOBAL

  if (!currentShip) {
    alert("Ship not found!");
    window.location.href = 'index.html';
    return;
  }

  $('#shipTitle') && ($('#shipTitle').textContent = `Ship: ${currentShip.name}`);
  $('#totPersonnel') && ($('#totPersonnel').textContent = currentShip.personnel);

  renderTankNav(currentShip);
  renderShipKPIsWithThresholds(currentShip);

  // default tank + thresholds + live
  if (currentShip.tanks.length > 0) {
    currentTankId = currentShip.tanks[0].id;
    selectTank(currentShip, currentTankId);
    await onTankSelected(currentShip.id, currentTankId);
    // initial sparks
    updateSparks(currentShip.id, currentTankId);
  } else {
    $('#tankTitle').textContent = "No tanks configured for this ship.";
    $('#sensorsWrap').innerHTML = '<p>Please add a tank to begin assigning sensors.</p>';
  }

  // ✅ Fetch permits and render the table
  const permitsRaw = await fetchPermitsForShip(currentShip.id);
  renderPermitSummary(normalizePermits(permitsRaw));

  // --- MERGED CHANGE: SIMULATED DATA POLL ---
  window.__shipPoll && clearInterval(window.__shipPoll);
  window.__shipPoll = setInterval(async () => {
    // Ensure the cache has data
    if (EXTERNAL_READINGS_CACHE.length === 0) {
      return; // Wait for data to be fetched
    }

    try {
      // Get the next reading from the cache
      const rawReading = EXTERNAL_READINGS_CACHE[liveReadingIndex];

      // Map the raw sensor data to our application's format
      const mappedValues = {
          H2S: rawReading.sensor1,
          CO:  rawReading.sensor2,
          O2:  rawReading.sensor3,
          LEL: rawReading.sensor4,
      };

      // Create a "live" data structure to feed into your render functions
      const live = {
        sensors: { 'Simulated-Sensor': mappedValues },
        aggregates: { display: mappedValues } // Use the same values for the main KPIs
      };

      // Update the UI with the simulated data
      renderTankSensorsLive(live.sensors);
      currentShip.live_o2  = live.aggregates?.display?.O2;
      currentShip.live_co  = live.aggregates?.display?.CO;
      currentShip.live_lel = live.aggregates?.display?.LEL;
      currentShip.live_h2s = live.aggregates?.display?.H2S;

      renderShipKPIsWithThresholds(currentShip);

      // Increment and wrap the index to loop through the cached data
      liveReadingIndex = (liveReadingIndex + 1) % EXTERNAL_READINGS_CACHE.length;

    } catch (e) {
      console.warn('Error in ship page polling loop:', e);
    }
  }, 2000); // The interval remains 2 seconds

  window.addEventListener('beforeunload', () => {
    window.__shipPoll && clearInterval(window.__shipPoll);
  });

  setupShipPageEventListeners(currentShip);
}

function renderTankNav(ship) {
  const nav = $('#tankNav');
  if (!nav) return;
  nav.innerHTML = '';
  ship.tanks.forEach(tank => {
    const b = document.createElement('div');
    b.className = 'tankbtn';
    b.dataset.tankId = tank.id;
    b.innerHTML = `
      <span>${tank.ship_specific_id} (${tank.sensors.length} sensors)</span>
      <button type="button" class="btn-delete small-btn" title="Delete Tank (Not Implemented)">X</button>
    `;
    nav.appendChild(b);
  });
}

function renderShipKPIs(ship){
  // kept for compatibility; not used on ship page anymore
  const fmt = v => (v === null || v === undefined) ? '—' : v;
  const elO2 = document.getElementById('kpiO2');
  const elCO = document.getElementById('kpiCO');
  const elLEL = document.getElementById('kpiLEL');
  const elH2S = document.getElementById('kpiH2S');
  if (elO2) elO2.textContent = fmt(ship.live_o2);
  if (elCO) elCO.textContent = fmt(ship.live_co);
  if (elLEL) elLEL.textContent = fmt(ship.live_lel);
  if (elH2S) elH2S.textContent = fmt(ship.live_h2s);
}

function selectTank(ship, tankId) {
  const selectedTank = ship.tanks.find(t => t.id === Number(tankId));
  if (!selectedTank) return;

  $all('.tankbtn').forEach(b => b.classList.remove('active'));
  const activeBtn = $(`.tankbtn[data-tank-id="${selectedTank.id}"]`);
  activeBtn && activeBtn.classList.add('active');

  $('#tankTitle') && ($('#tankTitle').textContent = `Details for Tank: ${selectedTank.ship_specific_id || selectedTank.id}`);
  // Sensor tiles now come from LIVE endpoint in onTankSelected()
  pushLog(`📦 Selected tank: ${selectedTank.id}`);
}

/* ======== Sensor assignment & modals ======== */
function renderSensorsForTank(tank) {
  // (kept for compatibility if needed elsewhere)
  const wrap = $('#sensorsWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!tank.sensors || tank.sensors.length === 0) {
    wrap.innerHTML = '<p>No sensors assigned to this tank.</p>';
  } else {
    tank.sensors.forEach(assignedSensor => {
      const masterSensor = SENSORS_CACHE.find(s => s.id === assignedSensor.id || s.id === assignedSensor.sensor_id);
      if (!masterSensor) return;
      const tile = document.createElement('div');
      tile.className = 'sensor';
      tile.innerHTML = `
        <div class="sensor-top">
          <div class="sensor-id">${masterSensor.id}</div>
          <div class="sensor-state ok">OK</div>
        </div>
        <div class="sensor-val">${masterSensor.type}</div>
        <div class="sensor-details">
          <span>📶 Str: --%</span>
          <span>🔋 Bat: ${masterSensor.battery ?? '—'}%</span>
        </div>
      `;
      wrap.appendChild(tile);
    });
  }

  const assignBtn = document.createElement('button');
  assignBtn.type = 'button';
  assignBtn.className = 'btn';
  assignBtn.id = 'assignSensorBtn';
  assignBtn.textContent = '+ Assign Sensors';
  assignBtn.dataset.tankId = tank.id;
  wrap.appendChild(assignBtn);
}

function setupShipPageEventListeners(shipCtx) {
  // remove/unassign a sensor from this tank (UI-first; best-effort API)
  $('#sensorsWrap') && $('#sensorsWrap').addEventListener('click', async (e) => {
    const btn = e.target.closest('.sensor-remove');
    if (!btn) return;
    const tile = btn.closest('.sensor');
    const sensorId = tile?.dataset?.sensorId;
    if (!sensorId) return;

    if (!confirm(`Unassign sensor ${sensorId} from this tank?`)) return;

    // Best-effort API (adjust if your backend uses a different route)
    try {
      const res = await fetch(`${API_BASE_URL}/api/ships/${shipCtx.id}/tanks/${currentTankId}/sensors/${encodeURIComponent(sensorId)}`, {
        method: 'DELETE'
      });
      // If API not implemented, still proceed with UI removal
    } catch {}

    // Remove from UI immediately
    tile.remove();
    showToast(`Sensor ${sensorId} removed`);
  });

  const addTankModal = $('#addTankModal');
  $('#addTankBtn') && ($('#addTankBtn').onclick = () => {
    const select = $('#newTankType');
    if (select) select.innerHTML = TANK_TYPES_CACHE.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    addTankModal.classList.remove('hidden');
  });
  $('#cancelAddTank') && ($('#cancelAddTank').onclick = () => addTankModal.classList.add('hidden'));
  $('#addTankForm') && ($('#addTankForm').onsubmit = async (e) => {
    e.preventDefault();
    const tankTypeSelect = $('#newTankType');
    const selectedTypeId = tankTypeSelect.value;
    let customName = $('#newTankName').value.trim();
    if (!customName) customName = tankTypeSelect.options[tankTypeSelect.selectedIndex].text;
    const tankData = { ship_specific_id: customName, type_id: selectedTypeId };
    try {
      const response = await fetch(`${API_BASE_URL}/api/ships/${shipCtx.id}/tanks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tankData),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail);
      }
      addTankModal.classList.add('hidden');
      await initShipPage(); // refresh page data
      showToast('Tank added');
      fetch(`${API_BASE_URL}/api/logs`, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({event:'add_tank', details:`[ship ${shipCtx.id}] tank '${customName}' added`})
      }).catch(()=>{});
    } catch (error) {
      alert(`Error adding tank: ${error.message}`);
    }
  });

  const assignSensorModal = $('#assignSensorModal');
  $('#sensorsWrap') && $('#sensorsWrap').addEventListener('click', e => {
    if (e.target && e.target.id === 'assignSensorBtn') {
      const tankId = e.target.dataset.tankId;
      $('#assignSensorTitle').textContent = `Assign Sensors to Tank: ${tankId}`;
      $('#assignSensorForm').dataset.tankId = tankId;
      assignSensorModal.classList.remove('hidden');
    }
  });
  $('#cancelAssignSensor') && ($('#cancelAssignSensor').onclick = () => assignSensorModal.classList.add('hidden'));
  $('#assignSensorForm') && ($('#assignSensorForm').onsubmit = async (e) => {
    e.preventDefault();
    const tankId = e.target.dataset.tankId;
    const sensorIds = $('#sensorIdsTextarea').value.split('\n').map(id => id.trim()).filter(id => id);
    if (sensorIds.length === 0) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/ships/${shipCtx.id}/tanks/${tankId}/sensors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sensor_ids: sensorIds }),
      });
      if (!response.ok) { const err = await response.json(); throw new Error(err.detail); }
      assignSensorModal.classList.add('hidden');
      await initShipPage();
      showToast('Sensors assigned');
      fetch(`${API_BASE_URL}/api/logs`, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({event:'assign_sensors', details:`[ship ${shipCtx.id} tank ${tankId}] assigned ${sensorIds.join(',')}`})
      }).catch(()=>{});
    } catch (error) { alert(`Error assigning sensors: ${error.message}`); }
  });

  $('#tankNav') && $('#tankNav').addEventListener('click', async (e) => {
    const tankBtn = e.target.closest('.tankbtn');
    if (tankBtn) {
      const newId = Number(tankBtn.dataset.tankId);
      selectTank(currentShip, newId);
      currentTankId = newId;
      await onTankSelected(currentShip.id, currentTankId);
      updateSparks(currentShip.id, currentTankId);
    }
  });

  $('#ackBtn') && ($('#ackBtn').onclick = async () => {
    pushLog('✅ Alarm acknowledged by user.');
    if (currentShip && currentShip.status === 'Danger') {
      try {
        await fetch(`${API_BASE_URL}/api/ships/${currentShip.id}/acknowledge`, { method: 'PUT' });
        alert(`Alarm for ${currentShip.name} acknowledged.`);
        showToast('Alarm acknowledged');
        fetch(`${API_BASE_URL}/api/logs`, {
          method:'POST',
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({event:'acknowledge', details:`[ship ${currentShip.id}] user acknowledged alarm`})
        }).catch(()=>{});
        window.location.href = 'index.html';
      } catch (error) { console.error("Error acknowledging alarm:", error); }
    }
  });
}

function pushLog(line){
  const box = $('#alarmLogs');
  if(!box) return;
  const row = document.createElement('div');
  row.textContent = `[${now().toLocaleTimeString()}] ${line}`;
  box.prepend(row);
}

/* ========== Page 3 (Sensor Inventory) ========== */
async function initInventoryPage() {
  await fetchMasterData();
  renderSensorTable(SENSORS_CACHE);
  const logModal = $('#logModal');
  $('#sensorTableBody') && $('#sensorTableBody').addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (row) showSensorDetails(row.dataset.sensorId);
  });
  $('#closeLogModal') && ($('#closeLogModal').onclick = () => logModal.classList.add('hidden'));
}

function renderSensorTable(sensors) {
  const tableBody = $('#sensorTableBody');
  if (!tableBody) return;
  tableBody.innerHTML = '';
  if (!sensors || sensors.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6">No sensors found in inventory.</td></tr>`;
    return;
  }
  sensors.forEach(sensor => {
    const row = document.createElement('tr');
    row.dataset.sensorId = sensor.id;
    row.innerHTML = `
      <td><strong>${sensor.id}</strong></td>
      <td>${sensor.type}</td>
      <td>${sensor.status}</td>
      <td>${sensor.battery ?? '—'}%</td>
      <td>${sensor.last_calibrated ?? '—'}</td>
      <td>${sensor.status === 'In Use' ? (sensor.last_used_on_ship ?? '—') : '—'}</td>
    `;
    tableBody.appendChild(row);
  });
}

async function showSensorDetails(sensorId) {
  const logModal = $('#logModal');
  try {
    const response = await fetch(`${API_BASE_URL}/api/master/sensors/${sensorId}`);
    const sensor = await response.json();

    $('#modalTitle') && ($('#modalTitle').textContent = `Sensor Log: ${sensor.id}`);
    $('#modalSensorInfo') && ($('#modalSensorInfo').innerHTML = `
      <div><strong>Type:</strong> ${sensor.type}</div>
      <div><strong>Status:</strong> ${sensor.status}</div>
      <div><strong>Battery:</strong> ${sensor.battery ?? '—'}%</div>
    `);

    const actions = document.querySelector('#logModal .modal-actions');
    if (actions) {
      actions.querySelector('#downloadLogsBtn')?.remove();
      const dl = document.createElement('a');
      dl.id = 'downloadLogsBtn';
      dl.href = `${API_BASE_URL}/api/master/sensors/${sensor.id}/logs.csv`;
      dl.className = 'btn';
      dl.textContent = 'Download CSV';
      dl.setAttribute('download', `${sensor.id}_logs.csv`);
      actions.insertBefore(dl, actions.firstChild);
    }

    const logContainer = $('#logEntries');
    if (logContainer) {
      logContainer.innerHTML = '';
      (sensor.logs || []).slice().reverse().forEach(log => {
        const formattedDate = new Date(log.timestamp).toLocaleString();
        const logEl = document.createElement('div');
        logEl.className = 'log-entry';
        logEl.innerHTML = `
          <div class="log-meta">
            <div><strong>${log.event}</strong></div>
            <div>${formattedDate}</div>
          </div>
          <div>${log.details || ''}</div>
        `;
        logContainer.appendChild(logEl);
      });
      if ((sensor.logs || []).length === 0) {
        logContainer.innerHTML = '<p>No log entries found for this device.</p>';
      }
    }

    logModal && logModal.classList.remove('hidden');
  } catch (error) {
    console.error(`Failed to fetch details for sensor ${sensorId}:`, error);
    alert('Could not load sensor details.');
  }
}

/* ========== Dockyard Drilldown Modals (Overview) ========== */
function showDockYardShips() {
  const modal = document.getElementById("dockyardModal");
  const shipList = document.getElementById("shipList");
  if (!modal || !shipList) return;
  shipList.innerHTML = "";
  SHIPS_CACHE.forEach(ship => {
    const card = document.createElement('div');
    card.className = 'ship-status';
    const statusLabel = ship.status === 'Danger' ? 'In Danger' : ship.status;
    const shipIconHTML = ship.image ? `<img src="${ship.image}" alt="${ship.name}">` : '🚢';
    card.innerHTML = `
      <div class="ship-icon">${shipIconHTML}</div>
      <div class="ship-status-name" title="${ship.name}">${ship.name}</div>
      <div class="badge ${badgeFor(ship.status)}">${statusLabel}</div>
    `;
    shipList.appendChild(card);
  });
  modal.style.display = "block";
}

function showDockYardShipsWIP() {
  const modal = document.getElementById("dockyardModal");
  const shipList = document.getElementById("shipList");
  if (!modal || !shipList) return;
  shipList.innerHTML = "";
  const wipShips = SHIPS_CACHE.filter(ship => ship.status === 'WIP');
  wipShips.forEach(ship => {
    const card = document.createElement('div');
    card.className = 'ship-status';
    const statusLabel = ship.status === 'Danger' ? 'In Danger' : ship.status;
    const shipIconHTML = ship.image ? `<img src="${ship.image}" alt="${ship.name}">` : '🚢';
    card.innerHTML = `
      <div class="ship-icon">${shipIconHTML}</div>
      <div class="ship-status-name" title="${ship.name}">${ship.name}</div>
      <div class="badge ${badgeFor(ship.status)}">${statusLabel}</div>
    `;
    shipList.appendChild(card);
  });
  modal.style.display = "block";
}

function renderPermitSummary(perms){
  const tb = document.getElementById('permitSummaryBody');
  if (!tb) return;
  if (!Array.isArray(perms) || !perms.length){
    tb.innerHTML = `<tr><td colspan="7">No permits found.</td></tr>`;
    return;
    }
  tb.innerHTML = perms.map(p => {
    const statusClass =
      p.status?.toLowerCase() === 'open'    ? 'open' :
      p.status?.toLowerCase() === 'pending' ? 'pending' : 'closed';
    const issued  = p.issued_at  ? new Date(p.issued_at).toLocaleString()  : '—';
    const expires = p.expires_at ? new Date(p.expires_at).toLocaleString() : '—';
    return `
      <tr>
        <td>${p.id ?? '—'}</td>
        <td>${p.type ?? '—'}</td>
        <td>${p.ship_id ?? '—'}</td>
        <td>${p.tank_id ?? '—'}</td>
        <td>${issued}</td>
        <td>${expires}</td>
        <td><span class="permit-status ${statusClass}">${p.status ?? '—'}</span></td>
      </tr>`;
  }).join('');
}

// Try multiple endpoints and shapes, then normalize rows for the table.
async function fetchPermitsForShip(shipId){
  const tryUrls = [
    `${API_BASE_URL}/api/ships/${encodeURIComponent(shipId)}/permits`,
    `${API_BASE_URL}/api/permits?ship_id=${encodeURIComponent(shipId)}`
  ];

  for (const url of tryUrls){
    try{
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : null);
      if (arr && arr.length) return arr;
    }catch(e){ /* ignore and try next */ }
  }

  // Fallback: if permits were embedded in ship object later
  const ship = SHIPS_CACHE.find(s => s.id === shipId);
  return ship?.permits || [];
}

// Map backend keys to the table row format used by renderPermitSummary()
function normalizePermits(rawPermits){
  return (rawPermits || []).map(p => ({
    id:        p.id ?? p.permit_id ?? p.number ?? p.code ?? '—',
    type:      p.type ?? p.permit_type ?? p.category ?? '—',
    ship_id:   p.ship_id ?? p.ship ?? p.vessel_id ?? '—',
    tank_id:   p.tank_id ?? p.tank ?? p.space_id ?? '—',
    issued_at: p.issued_at ?? p.issued ?? p.start_at ?? p.start ?? p.created_at ?? null,
    expires_at:p.expires_at ?? p.expiry ?? p.end_at ?? p.end ?? null,
    status:    p.status ?? p.state ?? p.phase ?? '—'
  }));
}

function showWorkingPersonnel() {
  const modal = document.getElementById("dockyardModal");
  const shipList = document.getElementById("shipList");
  if (!modal || !shipList) return;
  shipList.innerHTML = "";
  SHIPS_CACHE.forEach(ship => {
    const card = document.createElement('div');
    card.className = 'ship-status';
    const shipIconHTML = ship.image ? `<img src="${ship.image}" alt="${ship.name}">` : '🚢';
    card.innerHTML = `
      <div class="ship-icon">${shipIconHTML}</div>
      <div class="ship-status-name" title="${ship.name}">${ship.name}</div>
      <div class="badge">${ship.personnel}</div>
    `;
    shipList.appendChild(card);
  });
  modal.style.display = "block";
}

function showDockYardShipsDanger() {
  const modal = document.getElementById("dockyardModal");
  const shipList = document.getElementById("shipList");
  if (!modal || !shipList) return;
  shipList.innerHTML = "";
  const dangerShips = SHIPS_CACHE.filter(ship => ship.status === 'Danger');
  dangerShips.forEach(ship => {
    const card = document.createElement('div');
    card.className = 'ship-status';
    const statusLabel = ship.status === 'Danger' ? 'In Danger' : ship.status;
    const shipIconHTML = ship.image ? `<img src="${ship.image}" alt="${ship.name}">` : '🚢';
    card.innerHTML = `
      <div class="ship-icon">${shipIconHTML}</div>
      <div class="ship-status-name" title="${ship.name}">${ship.name}</div>
      <div class="badge ${badgeFor(ship.status)}">${statusLabel}</div>
    `;
    shipList.appendChild(card);
  });
  modal.style.display = "block";
}

function closeDockyardModal() {
  document.getElementById("dockyardModal")?.style && (document.getElementById("dockyardModal").style.display = "none");
}
window.onclick = function(event) {
  const modal = document.getElementById("dockyardModal");
  if (event.target === modal) {
    modal.style.display = "none";
  }
};

/* ========== Sparklines (ship KPIs) ========== */
async function fetchTankSeries(shipId, tankId, minutes=60){
  const url = `${API_BASE_URL}/api/ships/${shipId}/tanks/${tankId}/readings?minutes=${minutes}`;
  const res = await fetch(url);
  return await res.json();
}

function drawSpark(containerId, series, key, minY, maxY){
  const el = document.getElementById(containerId);
  if (!el) return;

  const w = el.clientWidth || 160, h = el.clientHeight || 46, p = 2;
  const xs = series.map((_,i)=> i/(Math.max(series.length-1,1)));
  const ys = series.map(r=>{
    const v = r[key];
    if (v==null) return null;
    const y = (v - minY) / (maxY - minY || 1);
    return 1 - Math.max(0, Math.min(1, y));
  });
  const pts = xs.map((x,i)=> ys[i]==null? null : `${p + x*(w-2*p)},${p + ys[i]*(h-20)}`).filter(Boolean);

  const start = new Date(series[0].timestamp || series[0].time || Date.now());
  const end   = new Date(series[series.length-1].timestamp || series[series.length-1].time || Date.now());
  const tickCount = 4;
  const tickTexts = [];

  for(let i=0;i<=tickCount;i++){
    const frac = i/tickCount;
    const t = new Date(start.getTime() + frac * (end - start));
    const label = t.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    tickTexts.push(`<text x="${p + frac*(w-2*p)}" y="${h-4}" font-size="7" fill="gray" text-anchor="middle">${label}</text>`);
  }

  el.innerHTML = `
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" opacity="0.9"/>
    ${tickTexts.join('')}
  </svg>`;
}

async function updateSparks(shipId, tankId){
  try{
    const data = await fetchTankSeries(shipId, tankId, 60); // last 60 min
    if (!data.length) return;
    const vals = k => data.map(d => d[k]).filter(v => v!=null);
    const mm  = (arr,lo,hi)=>[Math.min(...arr, lo), Math.max(...arr, hi)];
    const [o2min,o2max]   = mm(vals('O2'), 16, 21);
    const [comin,comax]   = mm(vals('CO'), 0, 120);
    const [lelmin,lelmax] = mm(vals('LEL'), 0, 20);
    const [h2smin,h2smax] = mm(vals('H2S'), 0, 20);
    drawSpark('sparkO2',  data, 'O2',  o2min, o2max);
    drawSpark('sparkCO',  data, 'CO',  comin, comax);
    drawSpark('sparkLEL', data, 'LEL', lelmin, lelmax);
    drawSpark('sparkH2S', data, 'H2S', h2smin, h2smax);
  }catch(e){
    // ignore spark failures to keep UI responsive
  }
}

/* ========== Timeline Page ========== */
async function initTimelinePage(){
  const body = document.getElementById('timelineBody');
  const ship = document.getElementById('fltShip');
  const tank = document.getElementById('fltTank');
  const sev  = document.getElementById('fltSeverity');
  const since= document.getElementById('fltSince');

  async function load(){
    body.innerHTML = `<tr><td colspan="6">Loading…</td></tr>`;
    const params = new URLSearchParams();
    if (ship.value) params.set('ship_id', ship.value.trim());
    if (tank.value) params.set('tank_id', tank.value.trim());
    if (sev.value)  params.set('severity', sev.value);
    if (since.value)params.set('minutes', since.value);
    const res = await fetch(`${API_BASE_URL}/api/logs?`+params.toString());
    const rows = await res.json();
    if (!rows.length){ body.innerHTML = `<tr><td colspan="6">No events found.</td></tr>`; return; }
    body.innerHTML = rows.map(r=>`
      <tr>
        <td>${new Date(r.timestamp).toLocaleString()}</td>
        <td>${r.ship_id ?? '—'}</td>
        <td>${r.tank_id ?? '—'}</td>
        <td>${r.severity ?? '—'}</td>
        <td>${r.event}</td>
        <td>${r.details || ''}</td>
      </tr>`).join('');
  }

  document.getElementById('btnRefreshTL').onclick = load;
  document.getElementById('btnExportTL').onclick = async ()=>{
    const rows = [...document.querySelectorAll('#timelineBody tr')].map(tr=>[...tr.children].map(td=> `"${td.textContent.replace(/"/g,'""')}"`).join(','));
    const csv = ["Time,Ship,Tank,Severity,Event,Details", ...rows].join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'timeline.csv'; a.click();
  };

  load();
}

/* ========== Bootstrap by page + Keyboard Shortcuts ========== */
document.addEventListener('DOMContentLoaded', () => {
  // --- NEW: Fetch external data on application start ---
  fetchAndCacheExternalReadings();

  if (document.getElementById('shipsList')) {
    // overview
    initClock('nowTime');
    initOverview();
  } else if (document.getElementById('tankNav')) {
    // ship page
    initClock('nowTime');
    initShipPage();
  } else if (document.getElementById('sensorTableBody')) {
    // inventory
    initClock('nowTime');
    initInventoryPage();
  } else if (document.getElementById('timelineBody')) {
    // timeline
    initClock('nowTime');
    initTimelinePage();
  }

  // Keyboard shortcuts (not inside inputs/textareas)
  document.addEventListener('keydown', (e)=>{
    if (e.target.matches('input, textarea')) return;
    const onOverview = !!document.getElementById('shipsList');
    const onShip = !!document.getElementById('tankNav');
    if (onOverview){
      if (e.key.toLowerCase()==='n') document.getElementById('addShipBtn')?.click();
      if (e.key.toLowerCase()==='g') location.href = 'inventory.html';
      if (e.key.toLowerCase()==='t') location.href = 'timeline.html';
    }
    if (onShip){
      if (e.key.toLowerCase()==='t') document.getElementById('addTankBtn')?.click();
      if (e.key.toLowerCase()==='a') document.getElementById('assignSensorBtn')?.click();
    }
  });
});
