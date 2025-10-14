/* ========== Utilities ========== */
function $(q, root=document){ return root.querySelector(q); }
function $all(q, root=document){ return [...root.querySelectorAll(q)]; }
function now(){ return new Date(); }
function initClock(id){
  const el = document.getElementById(id);
  const tick = ()=> el && (el.textContent = now().toLocaleTimeString());
  tick(); setInterval(tick, 1000);
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
    if (document.getElementById('shipsList')) {
      renderOverviewPage(SHIPS_CACHE);
    }
  });
  setInterval(async () => {
    await fetchMasterData();
    if (document.getElementById('shipsList')) {
      renderOverviewPage(SHIPS_CACHE);
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
  $('#spacesWarn').textContent = SHIPS_CACHE.filter(s => s.status === 'Warning').length;  // New line for Warning count


  const row = $('#shipsRow');
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

  const list = $('#shipsList');
  list.innerHTML = '';
  ships.forEach(ship=>{
    const el = document.createElement('div');
    el.className = 'shipcard';
    el.dataset.shipId = ship.id;
    const isDanger = ship.status === 'Danger';
    el.innerHTML = `
      <div>
        <button class="btn-delete" title="Delete Ship">X</button>
        <div class="shipmeta">
          <div class="shipname">${ship.name}</div>
          <div>Last Port: ${ship.lastPort}</div>
          <div>Arrived: ${ship.arrived}</div>
          <div>Status: <span class="badge ${badgeFor(ship.status)}">${ship.status}</span></div>
        </div>
      </div>
      <div class="ship-actions">
        <div class="status-button-group">
          <button class="btn-status ${ship.status === 'Idle' ? 'active' : ''}" data-status="Idle" ${isDanger ? 'disabled' : ''}>IDLE</button>
          <button class="btn-status ${ship.status === 'WIP' ? 'active' : ''}" data-status="WIP" ${isDanger ? 'disabled' : ''}>WIP</button>
        </div>
        <button class="btn-edit">Edit</button>
        <a class="btn enter" href="ship.html?ship=${encodeURIComponent(ship.id)}">ENTER</a>
      </div>
    `;
    list.appendChild(el);
  });
}

function setupOverviewEventListeners(){
  const addModal = $('#addShipModal');
  document.addEventListener('click', e => {
    if (e.target.closest('#addShipBtn')) {
      addModal.classList.remove('hidden');
    }
  });
  $('#cancelAddShip').onclick = () => addModal.classList.add('hidden');
  $('#addShipForm').onsubmit = async (e) => {
    e.preventDefault();
    const shipId = $('#newShipName').value.toUpperCase().replace(/\s/g, '');
    const newShipData = {
      // id: shipId,
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
    } catch (error) {
      console.error("Error creating ship:", error);
      alert("Error: Could not create ship. Check if the ID is unique.");
    }
  };

  const editModal = $('#editShipModal');
  $('#cancelEditShip').onclick = () => editModal.classList.add('hidden');
  $('#editShipForm').onsubmit = async (e) => {
    e.preventDefault();
    const shipId = $('#editShipId').value;
    const currentShip = SHIPS_CACHE.find(s => s.id === shipId);
    if (!currentShip) return;
    const updatedShipData = {
      name: $('#editShipName').value,
      lastPort: $('#editShipPort').value,
      personnel: parseInt($('#editShipPersonnel').value, 10),
      status: currentShip.status // Keep existing status
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
    } catch (error) {
      console.error("Error updating ship:", error);
    }
  };

  $('#shipsList').addEventListener('click', async (e) => {
    const card = e.target.closest('.shipcard');
    if (!card) return;
    const shipId = card.dataset.shipId;
    const ship = SHIPS_CACHE.find(s => s.id === shipId);
    if (!ship) return;

    if (e.target.classList.contains('btn-delete')) {
      if (confirm(`Are you sure you want to delete ship: ${ship.name}?`)) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/ships/${shipId}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('Failed to delete ship.');
          await fetchMasterData();
          renderOverviewPage(SHIPS_CACHE);
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
      } catch (error) {
        console.error("Error updating ship status:", error);
      }
    }
  });
}

function badgeFor(s){
  if(s==='Danger') return 'danger';
  if(s==='WIP') return 'ok';
  return 'gray';
}

/* ========== Page 2 (Ship details) ========== */
let currentShip = null;     // the ship object for this page
let currentTankId = null;   // the active tank on the left nav

async function initShipPage() {
  await fetchMasterData();

  const p = new URLSearchParams(location.search);
  const shipId = p.get('ship');
  const currentShip = SHIPS_CACHE.find(s => s.id === shipId);

  if (!currentShip) {
    alert("Ship not found!");
    window.location.href = 'index.html';
    return;
  }

  $('#shipTitle').textContent = `Ship: ${currentShip.name}`;
  $('#totPersonnel').textContent = currentShip.personnel;
  renderTankNav(currentShip);
  renderShipKPIs(currentShip);
  // poll every 2s for fresh values
  window.__shipPoll && clearInterval(window.__shipPoll);
  window.__shipPoll = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ships`);
      const ships = await res.json();
      const updated = ships.find(s => s.id === currentShip.id);
      if (updated) renderShipKPIs(updated);
    } catch (e) {
      console.warn('Ship poll failed', e);
    }
  }, 2000);

// (optional) clean up if you add page navigation SPA-style:
window.addEventListener('beforeunload', () => {
  window.__shipPoll && clearInterval(window.__shipPoll);
});
  setupShipPageEventListeners(currentShip);
  
  if (currentShip.tanks.length > 0) {
    selectTank(currentShip, currentShip.tanks[0].id);
  } else {
    $('#tankTitle').textContent = "No tanks configured for this ship.";
    $('#sensorsWrap').innerHTML = '<p>Please add a tank to begin assigning sensors.</p>';
  }
  async function onTankSelected(shipId, tankId) {
    try {
      CURRENT_THRESHOLDS = await fetchTankThresholds(shipId, tankId);
    } catch (e) {
      console.warn('Thresholds fetch failed, using defaults.', e);
      CURRENT_THRESHOLDS = null; // fallback handled by renderer
    }
    showThresholdsText(CURRENT_THRESHOLDS || {
      warn_o2_low:19.5, danger_o2_low:18,
      warn_co_high:35,  danger_co_high:100,
      warn_lel_high:5,  danger_lel_high:10
    });
    // render once with whatever live values we have
    renderShipKPIsWithThresholds(currentShip);
  }

}

function renderTankNav(ship) {
  const nav = $('#tankNav');
  nav.innerHTML = '';
  ship.tanks.forEach(tank => {
    const b = document.createElement('div');
    b.className = 'tankbtn';
    b.dataset.tankId = tank.id;
    b.innerHTML = `
      <span>${tank.ship_specific_id} (${tank.sensors.length} sensors)</span>
      <button class="btn-delete small-btn" title="Delete Tank (Not Implemented)">X</button>
    `;
    nav.appendChild(b);
  });
}

function renderShipKPIs(ship){
  const fmt = v => (v === null || v === undefined) ? '—' : v;
  const o2 = fmt(ship.live_o2);
  const co = fmt(ship.live_co);
  const lel = fmt(ship.live_lel);
  const elO2 = document.getElementById('kpiO2');
  const elCO = document.getElementById('kpiCO');
  const elLEL = document.getElementById('kpiLEL');
  if (elO2) elO2.textContent = o2;
  if (elCO) elCO.textContent = co;
  if (elLEL) elLEL.textContent = lel;
}
// cache for the currently selected tank's thresholds
let CURRENT_THRESHOLDS = null;

// GET per-tank thresholds (server returns defaults if none saved)
async function fetchTankThresholds(shipId, tankId) {
  const res = await fetch(`${API_BASE_URL}/api/ships/${shipId}/tanks/${tankId}/thresholds`);
  if (!res.ok) throw new Error(`threshold fetch failed ${res.status}`);
  return await res.json(); // {warn_o2_low,...}
}

// render the thresholds line under the KPIs
function showThresholdsText(T) {
  const el = document.getElementById('thresholdInfo');
  if (!el) return;
  el.innerHTML = `
    <small>
      O₂: warn ≤ <code>${T.warn_o2_low}%</code>, danger ≤ <code>${T.danger_o2_low}%</code> |
      CO: warn ≥ <code>${T.warn_co_high} ppm</code>, danger ≥ <code>${T.danger_co_high} ppm</code> |
      LEL: warn ≥ <code>${T.warn_lel_high}%</code>, danger ≥ <code>${T.danger_lel_high}%</code>
    </small>
  `;
}

// color a KPI card by thresholds (low-is-bad vs high-is-bad)
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

// write KPI numbers and apply CURRENT_THRESHOLDS (or defaults)
function renderShipKPIsWithThresholds(ship) {
  const fmt = v => (v === null || v === undefined) ? '—' : v;
  const elO2  = document.getElementById('kpiO2');
  const elCO  = document.getElementById('kpiCO');
  const elLEL = document.getElementById('kpiLEL');
  if (elO2)  elO2.textContent  = fmt(ship.live_o2);
  if (elCO)  elCO.textContent  = fmt(ship.live_co);
  if (elLEL) elLEL.textContent = fmt(ship.live_lel);

  const T = CURRENT_THRESHOLDS || {
    warn_o2_low:19.5, danger_o2_low:18,
    warn_co_high:35,  danger_co_high:100,
    warn_lel_high:5,  danger_lel_high:10
  };
  setKPIState('kpiO2',  ship.live_o2,  T.warn_o2_low,  T.danger_o2_low,  true);
  setKPIState('kpiCO',  ship.live_co,  T.warn_co_high, T.danger_co_high, false);
  setKPIState('kpiLEL', ship.live_lel, T.warn_lel_high,T.danger_lel_high,false);
}

function selectTank(ship, tankId) {
  const selectedTank = ship.tanks.find(t => t.id === tankId);
  if (!selectedTank) return;

  $all('.tankbtn').forEach(b => b.classList.remove('active'));
  $(`.tankbtn[data-tank-id="${tankId}"]`).classList.add('active');

  $('#tankTitle').textContent = `Details for Tank: ${selectedTank.id}`;
  renderSensorsForTank(selectedTank);
  pushLog(`📦 Selected tank: ${selectedTank.id}`);
}

function renderSensorsForTank(tank) {
  const wrap = $('#sensorsWrap');
  wrap.innerHTML = '';

  if (tank.sensors.length === 0) {
    wrap.innerHTML = '<p>No sensors assigned to this tank.</p>';
  } else {
    tank.sensors.forEach(assignedSensor => {
      const masterSensor = SENSORS_CACHE.find(s => s.id === assignedSensor.id);
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
          <span>🔋 Bat: ${masterSensor.battery}%</span>
        </div>
      `;
      wrap.appendChild(tile);
    });
  }

  const assignBtn = document.createElement('button');
  assignBtn.className = 'btn';
  assignBtn.id = 'assignSensorBtn';
  assignBtn.textContent = '+ Assign Sensors';
  assignBtn.dataset.tankId = tank.id;
  wrap.appendChild(assignBtn);
}

function setupShipPageEventListeners(currentShip) {
  const addTankModal = $('#addTankModal');
  $('#addTankBtn').onclick = () => {
    const select = $('#newTankType');
    select.innerHTML = TANK_TYPES_CACHE.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    addTankModal.classList.remove('hidden');
  };
  $('#cancelAddTank').onclick = () => addTankModal.classList.add('hidden');
  $('#addTankForm').onsubmit = async (e) => {
    e.preventDefault();
    
    const tankTypeSelect = $('#newTankType');
    const selectedTypeId = tankTypeSelect.value;
    let customName = $('#newTankName').value.trim();

    // If the user leaves the custom name blank, use the standard type's name as a default.
    if (!customName) {
        customName = tankTypeSelect.options[tankTypeSelect.selectedIndex].text;
    }

    const tankData = {
      ship_specific_id: customName,
      type_id: selectedTypeId
    };
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/ships/${currentShip.id}/tanks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tankData),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail);
      }
      addTankModal.classList.add('hidden');
      await initShipPage(); // Re-initialize the whole page to show changes
    } catch (error) {
      alert(`Error adding tank: ${error.message}`);
    }
};
  const assignSensorModal = $('#assignSensorModal');
  $('#sensorsWrap').addEventListener('click', e => {
    if (e.target.id === 'assignSensorBtn') {
      const tankId = e.target.dataset.tankId;
      $('#assignSensorTitle').textContent = `Assign Sensors to Tank: ${tankId}`;
      $('#assignSensorForm').dataset.tankId = tankId;
      assignSensorModal.classList.remove('hidden');
    }
  });
  $('#cancelAssignSensor').onclick = () => assignSensorModal.classList.add('hidden');
  $('#assignSensorForm').onsubmit = async (e) => {
    e.preventDefault();
    const tankId = e.target.dataset.tankId;
    const sensorIds = $('#sensorIdsTextarea').value.split('\n').map(id => id.trim()).filter(id => id);
    if (sensorIds.length === 0) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/ships/${currentShip.id}/tanks/${tankId}/sensors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sensor_ids: sensorIds }),
      });
      if (!response.ok) { const err = await response.json(); throw new Error(err.detail); }
      assignSensorModal.classList.add('hidden');
      await initShipPage();
    } catch (error) { alert(`Error assigning sensors: ${error.message}`); }
  };

  $('#tankNav').addEventListener('click', (e) => {
    const tankBtn = e.target.closest('.tankbtn');
    if (tankBtn) {
      selectTank(currentShip, tankBtn.dataset.tankId);
    }
  });
  
  $('#ackBtn').onclick = async () => {
    pushLog('✅ Alarm acknowledged by user.');
    if (currentShip && currentShip.status === 'Danger') {
      try {
        await fetch(`${API_BASE_URL}/api/ships/${currentShip.id}/acknowledge`, { method: 'PUT' });
        alert(`Alarm for ${currentShip.name} acknowledged.`);
        window.location.href = 'index.html';
      } catch (error) { console.error("Error acknowledging alarm:", error); }
    }
  };
}

function pushLog(line){
  const box = $('#alarmLogs');
  if(!box) return;
  const row = document.createElement('div');
  row.textContent = `[${now().toLocaleTimeString()}] ${line}`;
  box.prepend(row);
}

function setKPIState(id, value, warn, danger, isLow=false) {
  const el = document.getElementById(id);
  if (!el) return;
  const kpi = el.closest('.kpi');
  if (!kpi) return;
  kpi.classList.remove('ok','warn','danger');
  let state = 'ok';
  if ((isLow && value <= danger) || (!isLow && value >= danger)) state = 'danger';
  else if ((isLow && value <= warn) || (!isLow && value >= warn)) state = 'warn';
  kpi.classList.add(state);
}
// use same defaults as backend for now
const T = { warn_o2_low:19.5, danger_o2_low:18, warn_co_high:35, danger_co_high:100, warn_lel_high:5, danger_lel_high:10 };
// whenever you refresh KPIs:
setKPIState('kpiO2', currentShip.live_o2 ?? 21, T.warn_o2_low, T.danger_o2_low, true);
setKPIState('kpiCO', currentShip.live_co ?? 0,  T.warn_co_high, T.danger_co_high, false);
setKPIState('kpiLEL',currentShip.live_lel?? 0,  T.warn_lel_high, T.danger_lel_high,false);


/* ========== Page 3 (Sensor Inventory) ========== */
async function initInventoryPage() {
  await fetchMasterData();
  renderSensorTable(SENSORS_CACHE);
  
  const logModal = $('#logModal');
  $('#sensorTableBody').addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (row) showSensorDetails(row.dataset.sensorId);
  });
  $('#closeLogModal').onclick = () => logModal.classList.add('hidden');
}

function renderSensorTable(sensors) {
  const tableBody = $('#sensorTableBody');
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
      <td>${sensor.battery}%</td>
      <td>${sensor.last_calibrated}</td>
      <td>${sensor.status === 'In Use' ? sensor.last_used_on_ship : '—'}</td>
    `;
    tableBody.appendChild(row);
  });
}

async function showSensorDetails(sensorId) {
  const logModal = $('#logModal');
  try {
    const response = await fetch(`${API_BASE_URL}/api/master/sensors/${sensorId}`);
    const sensor = await response.json();

    $('#modalTitle').textContent = `Sensor Log: ${sensor.id}`;
    $('#modalSensorInfo').innerHTML = `
      <div><strong>Type:</strong> ${sensor.type}</div>
      <div><strong>Status:</strong> ${sensor.status}</div>
      <div><strong>Battery:</strong> ${sensor.battery}%</div>
    `;
    // AFTER you've set #modalTitle and #modalSensorInfo, add this:
    const actions = document.querySelector('#logModal .modal-actions');

    // avoid duplicates if user opens multiple sensors
    actions.querySelector('#downloadLogsBtn')?.remove();

    // create the download button
    const dl = document.createElement('a');
    dl.id = 'downloadLogsBtn';
    dl.href = `${API_BASE_URL}/api/master/sensors/${sensor.id}/logs.csv`;
    dl.className = 'btn';
    dl.textContent = 'Download CSV';
    dl.setAttribute('download', `${sensor.id}_logs.csv`);

    // put it at the start of the actions row (before "Close")
    actions.insertBefore(dl, actions.firstChild);

    const logContainer = $('#logEntries');
    logContainer.innerHTML = '';
    if (sensor.logs && sensor.logs.length > 0) {
      sensor.logs.forEach(log => {
        const logEl = document.createElement('div');
        logEl.className = 'log-entry';
        const formattedDate = new Date(log.timestamp).toLocaleString();
        logEl.innerHTML = `
          <div class="log-meta">
            <div><strong>${log.event}</strong></div>
            <div>${formattedDate}</div>
          </div>
          <div>${log.details}</div>
        `;
        logContainer.appendChild(logEl);
      });
    } else {
      logContainer.innerHTML = '<p>No log entries found for this device.</p>';
    }

    logModal.classList.remove('hidden');
  } catch (error) {
    console.error(`Failed to fetch details for sensor ${sensorId}:`, error);
    alert('Could not load sensor details.');
  }
}

/* ========== NEW: Drill-down Modals for Main Page ========== */
function showDockYardShips() {
  const modal = document.getElementById("dockyardModal");
  const shipList = document.getElementById("shipList");
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
  document.getElementById("dockyardModal").style.display = "none";
}

window.onclick = function(event) {
  const modal = document.getElementById("dockyardModal");
  if (event.target === modal) {
    modal.style.display = "none";
  }
};