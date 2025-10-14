/* ========== Utilities ========== */
function $(q, root=document){ return root.querySelector(q); }
function $all(q, root=document){ return [...root.querySelectorAll(q)]; }
function now(){ return new Date(); }
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
const API_BASE_URL = 'http://127.0.0.1:8000';
let SHIPS_CACHE = [];
let SENSORS_CACHE = [];
let TANK_TYPES_CACHE = [];

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
}

function setupOverviewEventListeners(){
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
  const fmt = v => (v === null || v === undefined) ? '—' : v;
  $('#kpiO2')  && ($('#kpiO2').textContent  = fmt(ship.live_o2));
  $('#kpiCO')  && ($('#kpiCO').textContent  = fmt(ship.live_co));
  $('#kpiLEL') && ($('#kpiLEL').textContent = fmt(ship.live_lel));

  const T = CURRENT_THRESHOLDS || {
    warn_o2_low:19.5, danger_o2_low:18,
    warn_co_high:35,  danger_co_high:100,
    warn_lel_high:5,  danger_lel_high:10
  };
  setKPIState('kpiO2',  ship.live_o2,  T.warn_o2_low,  T.danger_o2_low,  true);
  setKPIState('kpiCO',  ship.live_co,  T.warn_co_high, T.danger_co_high, false);
  setKPIState('kpiLEL', ship.live_lel, T.warn_lel_high,T.danger_lel_high,false);
}

/* Render live sensor tiles for the selected tank */
function renderTankSensorsLiveMapToTiles(sensorsMap) {
  const entries = Object.entries(sensorsMap || {}); // [[id,{O2,CO,LEL}], ...]
  if (entries.length === 0) {
    return '<p>No live sensors reporting for this tank.</p>';
  }
  return entries.map(([sid, vals]) => {
    const o2  = (vals.O2  ?? '—');
    const co  = (vals.CO  ?? '—');
    const lel = (vals.LEL ?? '—');
    return `
      <div class="sensor">
        <div class="sensor-top">
          <div class="sensor-id">${sid}</div>
        </div>
        <div class="sensor-val">O₂: <strong>${o2}</strong>%</div>
        <div class="sensor-val">CO: <strong>${co}</strong> ppm</div>
        <div class="sensor-val">LEL: <strong>${lel}</strong>%</div>
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
    warn_lel_high:5,  danger_lel_high:10
  });

  try {
    const live = await fetchTankLive(shipId, tankId);
    renderTankSensorsLive(live.sensors);
    // Use DISPLAY aggregate for KPIs (overview)
    currentShip.live_o2  = live.aggregates?.display?.O2  ?? currentShip.live_o2;
    currentShip.live_co  = live.aggregates?.display?.CO  ?? currentShip.live_co;
    currentShip.live_lel = live.aggregates?.display?.LEL ?? currentShip.live_lel;
  } catch (e) {
    console.warn('Live tank fetch failed', e);
  }

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

  // poll every 2s for fresh values + live sensors
  window.__shipPoll && clearInterval(window.__shipPoll);
  window.__shipPoll = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ships`);
      const ships = await res.json();
      const updated = ships.find(s => s.id === currentShip.id);
      if (updated) {
        currentShip = updated;
        // refresh live sensors for current tank and sync KPIs to DISPLAY aggregate
        if (currentTankId != null) {
          try {
            const live = await fetchTankLive(currentShip.id, currentTankId);
            renderTankSensorsLive(live.sensors);
            currentShip.live_o2  = live.aggregates?.display?.O2  ?? currentShip.live_o2;
            currentShip.live_co  = live.aggregates?.display?.CO  ?? currentShip.live_co;
            currentShip.live_lel = live.aggregates?.display?.LEL ?? currentShip.live_lel;
          } catch(e) { /* keep last visuals if live fails */ }
        }
        renderShipKPIsWithThresholds(currentShip);
        // refresh sparks occasionally
        if (currentTankId != null) { updateSparks(currentShip.id, currentTankId); }
      }
    } catch (e) {
      console.warn('Ship poll failed', e);
    }
  }, 2000);

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
  if (elO2) elO2.textContent = fmt(ship.live_o2);
  if (elCO) elCO.textContent = fmt(ship.live_co);
  if (elLEL) elLEL.textContent = fmt(ship.live_lel);
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
  const w = el.clientWidth || 120, h = el.clientHeight || 26, p=2;
  const xs = series.map((_,i)=> i/(Math.max(series.length-1,1)));
  const ys = series.map(r=>{
    const v = r[key]; 
    if (v==null) return null;
    const y = (v - minY) / (maxY - minY || 1);
    return 1 - Math.max(0, Math.min(1, y));
  });
  const pts = xs.map((x,i)=> ys[i]==null? null : `${p + x*(w-2*p)},${p + ys[i]*(h-2*p)}`).filter(Boolean);
  el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" opacity="0.9"/>
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
    drawSpark('sparkO2',  data, 'O2',  o2min, o2max);
    drawSpark('sparkCO',  data, 'CO',  comin, comax);
    drawSpark('sparkLEL', data, 'LEL', lelmin, lelmax);
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
