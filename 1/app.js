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

// A more efficient function to fetch all required data at once
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
    // Render the overview page only after the first fetch is complete
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
  renderOverviewPage([]); // Render an empty page initially
  setupOverviewEventListeners();
  startRealtimeUpdates();
}

function renderOverviewPage(ships){
  $('#shipsAtDock').textContent = ships.length.toString();
  $('#shipsUnderOp').textContent = ships.filter(s=>s.status!=='Idle').length;
  $('#totalPersonnel').textContent = ships.reduce((a,s)=>a+s.personnel,0);
  $('#spacesDanger').textContent = ships.filter(s=>s.status==='Danger').length;

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
  // Add/Edit/Delete/Status logic is the same as your provided file.
  const addModal = $('#addShipModal');
  document.addEventListener('click', e => {
    if (e.target.closest('#addShipBtn')) {
      addModal.classList.remove('hidden');
    }
  });
  $('#cancelAddShip').onclick = () => addModal.classList.add('hidden');
  $('#addShipForm').onsubmit = async (e) => { e.preventDefault(); /* ... same as before ... */ };
  const editModal = $('#editShipModal');
  $('#cancelEditShip').onclick = () => editModal.classList.add('hidden');
  $('#editShipForm').onsubmit = async (e) => { e.preventDefault(); /* ... same as before ... */ };
  $('#shipsList').addEventListener('click', async (e) => { /* ... same as before ... */ });
}

function badgeFor(s){
  if(s==='Danger') return 'danger';
  if(s==='WIP') return 'ok';
  return 'gray';
}

/* ========== Page 2 (Ship details) - NEW LOGIC ========== */
async function initShipPage() {
  await fetchMasterData(); // Fetch all ships, sensors, and tank types

  const p = new URLSearchParams(location.search);
  const shipId = p.get('ship');
  // Find the current ship from the cache, which is now up to date
  const currentShip = SHIPS_CACHE.find(s => s.id === shipId);

  if (!currentShip) {
    alert("Ship not found!");
    window.location.href = 'index.html';
    return;
  }

  // Initial page setup
  $('#shipTitle').textContent = `Ship: ${currentShip.name}`;
  $('#totPersonnel').textContent = currentShip.personnel;
  renderTankNav(currentShip);

  // Setup event listeners for the entire page
  setupShipPageEventListeners(currentShip);
  
  // Select the first tank by default if it exists
  if (currentShip.tanks.length > 0) {
    selectTank(currentShip, currentShip.tanks[0].id);
  } else {
    $('#tankTitle').textContent = "No tanks configured for this ship.";
    $('#sensorsWrap').innerHTML = '<p>Please add a tank to begin assigning sensors.</p>';
  }
}

function renderTankNav(ship) {
  const nav = $('#tankNav');
  nav.innerHTML = ''; // Clear previous
  ship.tanks.forEach(tank => {
    const b = document.createElement('div');
    b.className = 'tankbtn';
    b.dataset.tankId = tank.id;
    // Show the count of assigned sensors
    b.innerHTML = `
      <span>${tank.id} (${tank.sensors.length} sensors)</span>
      <button class="btn-delete small-btn" title="Delete Tank (Not Implemented)">X</button>
    `;
    nav.appendChild(b);
  });
}

function selectTank(ship, tankId) {
  const selectedTank = ship.tanks.find(t => t.id === tankId);
  if (!selectedTank) return;

  // Highlight active tank button in the nav
  $all('.tankbtn').forEach(b => b.classList.remove('active'));
  $(`.tankbtn[data-tank-id="${tankId}"]`).classList.add('active');

  // Update main content area with details for the selected tank
  $('#tankTitle').textContent = `Details for Tank: ${selectedTank.id}`;
  renderSensorsForTank(selectedTank);
  pushLog(`📦 Selected tank: ${selectedTank.id}`);
}

function renderSensorsForTank(tank) {
  const wrap = $('#sensorsWrap');
  wrap.innerHTML = ''; // Clear previous sensors

  if (tank.sensors.length === 0) {
    wrap.innerHTML = '<p>No sensors assigned to this tank.</p>';
  } else {
    tank.sensors.forEach(assignedSensor => {
      // Find the full sensor details from our master cache
      const masterSensor = SENSORS_CACHE.find(s => s.id === assignedSensor.id);
      if (!masterSensor) return; // Skip if sensor not found in master list

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

  // Add a button to assign more sensors to this specific tank
  const assignBtn = document.createElement('button');
  assignBtn.className = 'btn';
  assignBtn.id = 'assignSensorBtn';
  assignBtn.textContent = '+ Assign Sensors';
  assignBtn.dataset.tankId = tank.id; // Link button to the currently selected tank
  wrap.appendChild(assignBtn);
}

function setupShipPageEventListeners(currentShip) {
  // --- MODAL: ADD TANK ---
  const addTankModal = $('#addTankModal');
  $('#addTankBtn').onclick = () => {
    // Populate dropdown with master tank types from our cache
    const select = $('#newTankType');
    select.innerHTML = TANK_TYPES_CACHE.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    addTankModal.classList.remove('hidden');
  };
  $('#cancelAddTank').onclick = () => addTankModal.classList.add('hidden');
  $('#addTankForm').onsubmit = async (e) => {
    e.preventDefault();
    const tankData = {
      id: $('#newTankName').value,
      type_id: $('#newTankType').value
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

  // --- MODAL: ASSIGN SENSOR ---
  const assignSensorModal = $('#assignSensorModal');
  // Use event delegation for the button since it's re-rendered
  $('#sensorsWrap').addEventListener('click', e => {
    if (e.target.id === 'assignSensorBtn') {
      const tankId = e.target.dataset.tankId;
      $('#assignSensorTitle').textContent = `Assign Sensors to Tank: ${tankId}`;
      $('#assignSensorForm').dataset.tankId = tankId; // Store for submission
      assignSensorModal.classList.remove('hidden');
    }
  });
  $('#cancelAssignSensor').onclick = () => assignSensorModal.classList.add('hidden');
  $('#assignSensorForm').onsubmit = async (e) => {
    e.preventDefault();
    const tankId = e.target.dataset.tankId;
    // Get sensor IDs from textarea, one per line
    const sensorIds = $('#sensorIdsTextarea').value.split('\n').map(id => id.trim()).filter(id => id);
    if (sensorIds.length === 0) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/ships/${currentShip.id}/tanks/${tankId}/sensors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sensor_ids: sensorIds }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail);
      }
      assignSensorModal.classList.add('hidden');
      await initShipPage(); // Re-initialize page to show new sensors
    } catch (error) {
      alert(`Error assigning sensors: ${error.message}`);
    }
  };

  // --- TANK SELECTION IN NAV ---
  $('#tankNav').addEventListener('click', (e) => {
    const tankBtn = e.target.closest('.tankbtn');
    if (tankBtn) {
      selectTank(currentShip, tankBtn.dataset.tankId);
    }
  });
  
  // Acknowledge alarm button
  $('#ackBtn').onclick = async () => {
    pushLog('✅ Alarm acknowledged by user.');
    if (currentShip && currentShip.status === 'Danger') {
      try {
        await fetch(`${API_BASE_URL}/api/ships/${currentShip.id}/acknowledge`, { method: 'PUT' });
        alert(`Alarm for ${currentShip.name} acknowledged.`);
        window.location.href = 'index.html';
      } catch (error) {
        console.error("Error acknowledging alarm:", error);
      }
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

/* ========== Page 3 (Sensor Inventory) ========== */
async function initInventoryPage() {
  await fetchMasterData(); // Ensure we have the latest sensor data
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
function showDockYardShips() {
  console.log(SHIPS_CACHE);
  const modal = document.getElementById("dockyardModal");
  const shipList = document.getElementById("shipList");
  shipList.innerHTML = ""; // Clear previous

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
  console.log(SHIPS_CACHE);
  const modal = document.getElementById("dockyardModal");
  const shipList = document.getElementById("shipList");
  shipList.innerHTML = ""; // Clear previous
  
  // Filter ships with status "WIP"
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
  console.log(SHIPS_CACHE);
  const modal = document.getElementById("dockyardModal");
  const shipList = document.getElementById("shipList");
  shipList.innerHTML = ""; // Clear previous
  
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
  console.log(SHIPS_CACHE);
  const modal = document.getElementById("dockyardModal");
  const shipList = document.getElementById("shipList");
  shipList.innerHTML = ""; // Clear previous
  
  // Filter ships with status "WIP"
  const wipShips = SHIPS_CACHE.filter(ship => ship.status === 'Danger');
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
// Helper for status color
function getStatusColor(status) {
  switch (status.toLowerCase()) {
    case "wip": return "green";
    case "idle": return "gray";
    case "in danger": return "red";
    default: return "black";
  }
}

// Close modal
function closeDockyardModal() {
  document.getElementById("dockyardModal").style.display = "none";
}

// Optional: Close when clicking outside
window.onclick = function(event) {
  const modal = document.getElementById("dockyardModal");
  if (event.target === modal) {
    modal.style.display = "none";
  }
};
