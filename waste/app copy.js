/* ========== Utilities ========== */
function $(q, root=document){ return root.querySelector(q); }
function $all(q, root=document){ return [...root.querySelectorAll(q)]; }
function fmtPct(v){ return `${v.toFixed(1)}%`; }
function fmtPpm(v){ return `${Math.round(v)} ppm`; }
function now(){ return new Date(); }
function initClock(id){
  const el = document.getElementById(id);
  const tick = ()=> el && (el.textContent = now().toLocaleTimeString());
  tick(); setInterval(tick, 1000);
}

/* ========== Mock Data & State Management ========== */
// Default data if sessionStorage is empty
const DEFAULT_SHIPS = [
  {
    id: 'MANTA',
    name: 'MT Great Manta',
    lastPort: 'Panama',
    arrived: '10:00 HRS',
    status: 'WIP',
    personnel: 12,
    tanks: [
      { id:'Cargo Tank 1', sensors: [
        { id: 'S-01', battery: 98, network: 88 },
        { id: 'S-02', battery: 99, network: 92 },
        { id: 'S-03', battery: 95, network: 85 },
        { id: 'S-04', battery: 97, network: 90 },
      ]},
      { id:'HFO Tank', sensors: [
        { id: 'H-T1', battery: 91, network: 95 },
        { id: 'H-T2', battery: 93, network: 94 },
      ]},
      { id:'MGO Tank', sensors: [
        { id: 'M-G1', battery: 88, network: 80 },
        { id: 'M-G2', battery: 85, network: 78 },
        { id: 'M-G3', battery: 89, network: 81 },
      ]},
      { id:'FW Tank', sensors: [
        { id: 'F-W1', battery: 100, network: 99 },
      ]}
    ]
  },
  { id:'SEAHORSE', name:'MV Seahorse', lastPort:'Doha', arrived:'09:10 HRS', status:'WIP', personnel: 10, tanks:[{id:'HFO Tank', sensors:[{id:'SH-1', battery:90, network:90}]},{id:'FW Tank', sensors:[{id:'SH-2', battery:90, network:90}]}]},
  { id:'KRISHNA', name:'INS Krishna', lastPort:'Vizag', arrived:'08:40 HRS', status:'Idle', personnel: 8, tanks:[{id:'Ballast Tank', sensors:[{id:'SK-1', battery:90, network:90}]},{id:'FW Tank', sensors:[{id:'SK-2', battery:90, network:90}]}]},
  { id:'SINDHU', name:'INS Sindhu', lastPort:'Cochin', arrived:'07:55 HRS', status:'Danger', personnel: 14, tanks:[{id:'Cargo Tank 2', sensors:[{id:'SS-1', battery:90, network:90}]}]},
];

let SHIPS = JSON.parse(sessionStorage.getItem('ships')) || DEFAULT_SHIPS;

function saveShips(){
  sessionStorage.setItem('ships', JSON.stringify(SHIPS));
}

const TH = {
  O2: { warn: 19.5, danger: 18.0, type: 'low', unit:'%' },
  CO: { warn: 50, danger: 100, type: 'high', unit:'ppm' },
  LEL:{ warn: 7, danger: 10, type: 'high', unit:'%' }
};

function classify(val, {warn,danger,type}){
  if(type==='low'){
    if(val <= danger) return 'danger';
    if(val <= warn)   return 'warn';
    return 'ok';
  }else{
    if(val >= danger) return 'danger';
    if(val >= warn)   return 'warn';
    return 'ok';
  }
}

/* ========== Page 1 (Overview) ========== */
let isEmergencyActive = false; // Global state for the alarm

function initOverview(){
  renderOverviewPage();
  setupOverviewEventListeners();
}

function renderOverviewPage(){
  $('#shipsAtDock').textContent = SHIPS.length.toString();
  $('#shipsUnderOp').textContent = SHIPS.filter(s=>s.status!=='Idle').length;
  $('#totalPersonnel').textContent = SHIPS.reduce((a,s)=>a+s.personnel,0);
  $('#spacesWarn').textContent = 1;
  $('#spacesDanger').textContent = SHIPS.filter(s=>s.status==='Danger').length;

  const row = $('#shipsRow');
  row.innerHTML = '';
  SHIPS.forEach(ship => {
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
  $('#addShipBtn').onclick = ()=> $('#addShipModal').classList.remove('hidden');

  const list = $('#shipsList');
  list.innerHTML = '';
  SHIPS.forEach(ship=>{
    const el = document.createElement('div');
    el.className = 'shipcard';
    el.dataset.shipId = ship.id;
    const isDanger = ship.status === 'Danger';
    el.innerHTML = `
      <div> <button class="btn-delete" title="Delete Ship">X</button>
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
  // --- MODIFIED EMERGENCY ALARM LOGIC ---
  const modal = $('#emModal');
  const emergencyButton = $('#btnEmergency');
  const confirmBtn = $('#confirmEm');
  const modalTitle = modal.querySelector('h3');
  const modalText = modal.querySelector('p');

  // When the main button is clicked, set the modal's text and show it
  emergencyButton.onclick = () => {
    if (isEmergencyActive) {
      modalTitle.textContent = "Confirm Emergency Cancellation";
      modalText.textContent = "This will stop the alarm and return the system to normal. Proceed?";
      confirmBtn.textContent = "Cancel Alarm";
      confirmBtn.className = 'btn'; // Change button color to blue for cancel
    } else {
      modalTitle.textContent = "Confirm Emergency Alarm";
      modalText.textContent = "This will notify all crews and trigger sirens. Proceed?";
      confirmBtn.textContent = "Trigger Alarm";
      confirmBtn.className = 'btn-danger'; // Keep button red for trigger
    }
    modal.classList.remove('hidden');
  };

  // The cancel button in the modal just hides it
  $('#cancelEm').onclick = () => {
    modal.classList.add('hidden');
  };

  // The confirm button handles both activating and deactivating the alarm
  confirmBtn.onclick = () => {
    isEmergencyActive = !isEmergencyActive; // Toggle the alarm state

    const marquee = $('#emergencyMarquee');
    const dangerBox = $all('.statcard.danger')[0];

    if (isEmergencyActive) {
      // --- ACTIVATE ALARM ---
      alert('🚨 Emergency Alarm broadcast to all ships & crews!');
      marquee.classList.remove('hidden');
      if (dangerBox) dangerBox.classList.add('acknowledged');
      emergencyButton.textContent = 'CANCEL EMERGENCY ALARM';
    } else {
      // --- DEACTIVATE ALARM ---
      alert('✅ Emergency Alarm has been cancelled.');
      marquee.classList.add('hidden');
      if (dangerBox) dangerBox.classList.remove('acknowledged');
      emergencyButton.textContent = 'RAISE EMERGENCY ALARM';
    }

    modal.classList.add('hidden');
  };

  // --- Add/Edit Ship Logic (no changes below) ---
  const addModal = $('#addShipModal');
  $('#cancelAddShip').onclick = ()=> addModal.classList.add('hidden');
  $('#addShipForm').onsubmit = (e)=>{
    e.preventDefault();
    const imageFile = $('#newShipImage').files[0];
    const newShipData = {
      id: $('#newShipName').value.toUpperCase().replace(/\s/g, ''),
      name: $('#newShipName').value,
      lastPort: $('#newShipPort').value,
      arrived: now().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + ' HRS',
      status: 'Idle',
      personnel: parseInt($('#newShipPersonnel').value, 10),
      tanks: [{ id: 'Default Tank', sensors: [{ id: 'S-01', battery: 100, network: 100 }] }],
      image: null
    };
    if (imageFile) {
      const reader = new FileReader();
      reader.onload = function(event) {
        newShipData.image = event.target.result;
        SHIPS.push(newShipData);
        saveShips();
        renderOverviewPage();
      };
      reader.readAsDataURL(imageFile);
    } else {
      SHIPS.push(newShipData);
      saveShips();
      renderOverviewPage();
    }
    addModal.classList.add('hidden');
    e.target.reset();
  };

  const editModal = $('#editShipModal');
  $('#cancelEditShip').onclick = () => editModal.classList.add('hidden');
  $('#editShipForm').onsubmit = (e) => {
    e.preventDefault();
    const shipId = $('#editShipId').value;
    const ship = SHIPS.find(s => s.id === shipId);
    if (!ship) return;
    ship.name = $('#editShipName').value;
    ship.lastPort = $('#editShipPort').value;
    ship.personnel = parseInt($('#editShipPersonnel').value, 10);
    const imageFile = $('#editShipImage').files[0];
    if (imageFile) {
        const reader = new FileReader();
        reader.onload = function(event) {
            ship.image = event.target.result;
            saveShips();
            renderOverviewPage();
        };
        reader.readAsDataURL(imageFile);
    } else {
        saveShips();
        renderOverviewPage();
    }
    editModal.classList.add('hidden');
  };

  $('#shipsList').addEventListener('click', (e) => {
    const card = e.target.closest('.shipcard');
    if (!card) return;
    const shipId = card.dataset.shipId;
    if (e.target.classList.contains('btn-delete')) {
      if (confirm(`Are you sure you want to delete ship ${shipId}?`)) {
        SHIPS = SHIPS.filter(s => s.id !== shipId);
        saveShips();
        renderOverviewPage();
      }
    }
    if (e.target.classList.contains('btn-edit')) {
      const ship = SHIPS.find(s => s.id === shipId);
      if (ship) {
        $('#editShipId').value = ship.id;
        $('#editShipName').value = ship.name;
        $('#editShipPort').value = ship.lastPort;
        $('#editShipPersonnel').value = ship.personnel;
        $('#editShipImage').value = '';
        editModal.classList.remove('hidden');
      }
    }
    if (e.target.classList.contains('btn-status')) {
      const newStatus = e.target.dataset.status;
      const ship = SHIPS.find(s => s.id === shipId);
      if (ship) {
        ship.status = newStatus;
        saveShips();
        renderOverviewPage();
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
let currentShip = null;
let currentTank = null;

function initShipPage(){
  const p = new URLSearchParams(location.search);
  const shipId = p.get('ship');
  currentShip = SHIPS.find(s=>s.id===shipId) || SHIPS[0];
  alert(`Successfully entered dashboard for ship: ${currentShip.name}`);
  $('#shipTitle').textContent = `Ship: ${currentShip.name}`;
  $('#totPersonnel').textContent = currentShip.personnel;
  renderTankNav();
  setupShipPageEventListeners();
  if(currentShip.tanks.length > 0){
    selectTank(currentShip.tanks[0].id);
  } else {
    $('#tankTitle').textContent = 'No tanks available for this ship.';
  }
  pushLog('System online. Awaiting readings…');
  startMockStream((reading)=>{
    if(currentTank){
      updateKpis(reading);
      updateSensors(reading);
    }
  });
}

function renderTankNav(){
  const nav = $('#tankNav');
  nav.innerHTML = '';
  currentShip.tanks.forEach((t)=>{
    const b = document.createElement('button');
    b.className = 'tankbtn';
    b.dataset.tankId = t.id;
    b.innerHTML = `<span>${t.id}</span> <button class="btn-delete" title="Delete Tank">X</button>`;
    nav.appendChild(b);
  });
}

function setupShipPageEventListeners(){
  $('#tankNav').onclick = (e) => {
    const tankBtn = e.target.closest('.tankbtn');
    if(!tankBtn) return;
    if(e.target.classList.contains('btn-delete')){
      const tankId = tankBtn.dataset.tankId;
      if(confirm(`Are you sure you want to delete tank: ${tankId}?`)){
        currentShip.tanks = currentShip.tanks.filter(t => t.id !== tankId);
        saveShips();
        renderTankNav();
        if(currentTank && currentTank.id === tankId){
          if(currentShip.tanks.length > 0){
            selectTank(currentShip.tanks[0].id);
          } else {
            $('#tankTitle').textContent = 'No tanks available.';
            $('#sensorsWrap').innerHTML = '';
            currentTank = null;
          }
        }
      }
    } else {
      selectTank(tankBtn.dataset.tankId);
    }
  };
  $('#addTankBtn').onclick = () => {
    const newTankName = prompt("Enter the name for the new tank:");
    if(newTankName && newTankName.trim() !== ''){
      currentShip.tanks.push({
        id: newTankName.trim(),
        sensors: [{ id: 'NS-01', battery: 100, network: 100 }]
      });
      saveShips();
      renderTankNav();
      selectTank(newTankName.trim());
    }
  };
  $('#ackBtn').onclick = ()=> pushLog('✅ Alarm acknowledged by user.');
  const evacModal = $('#evacModal');
  $('#evacBtn').onclick = ()=> evacModal.classList.remove('hidden');
  $('#evacCancel').onclick = ()=> evacModal.classList.add('hidden');
  $('#evacConfirm').onclick = ()=>{
    pushLog('🚨 Evacuation protocol initiated!');
    evacModal.classList.add('hidden');
  };
}

function selectTank(tankId){
  currentTank = currentShip.tanks.find(t=>t.id === tankId);
  if(!currentTank) return;
  $('#tankTitle').textContent = 'Avg. Readings — ' + currentTank.id;
  $all('.tankbtn').forEach(b=>b.classList.remove('active'));
  $all('.tankbtn').find(b=>b.dataset.tankId===tankId).classList.add('active');
  renderSensors(currentTank.sensors);
  pushLog(`📦 Selected tank: ${currentTank.id}`);
}

/* ========== Rendering helpers (Ship page) ========== */
function renderSensors(sensors){
  const wrap = $('#sensorsWrap');
  wrap.innerHTML = '';
  if (!sensors || sensors.length === 0) {
    wrap.innerHTML = '<p>No sensors found in this tank.</p>';
    return;
  }
  sensors.forEach((s, i)=>{
    const tile = document.createElement('div');
    tile.className = 'sensor';
    tile.innerHTML = `
      <div class="sensor-top">
        <div class="sensor-id">${s.id}</div>
        <div class="sensor-state ok" id="state-${s.id}">OK</div>
      </div>
      <div class="sensor-val" id="val-${s.id}">—</div>
      <div class="muted">CO / O₂ / LEL</div>
      <div class="sensor-details">
        <span>📶 Str: ${s.network}%</span>
        <span>🔋 Bat: ${s.battery}%</span>
      </div>
    `;
    wrap.appendChild(tile);
  });
}

function updateKpis({O2,CO,LEL}){
  const sets = [
    {key:'O2', val:O2,   fmt:fmtPct,  el:'#kpiO2',  spark:'#sparkO2'},
    {key:'CO', val:CO,   fmt:fmtPpm,  el:'#kpiCO',  spark:'#sparkCO'},
    {key:'LEL',val:LEL,  fmt:fmtPct,  el:'#kpiLEL', spark:'#sparkLEL'}
  ];
  sets.forEach(s=>{
    const kpi = $(s.el).closest('.kpi');
    const state = classify(s.val, TH[s.key]);
    kpi.classList.remove('ok','warn','danger');
    kpi.classList.add(state);
    $(s.el).textContent = s.fmt(s.val);
    drawSpark($(s.spark), s.val, state);
  });
  const warn = (O2<=TH.O2.warn || CO>=TH.CO.warn || LEL>=TH.LEL.warn) ? 1 : 0;
  const dang = (O2<=TH.O2.danger || CO>=TH.CO.danger || LEL>=TH.LEL.danger) ? 1 : 0;
  $('#totWarn').textContent = warn;
  $('#totDanger').textContent = dang;
  if(dang){ pushLog('‼️ Threshold DANGER reached.'); }
}

function updateSensors({O2,CO,LEL}){
  if(!currentTank || !currentTank.sensors) return;
  currentTank.sensors.forEach((sensor, i)=>{
    const adj = i * 0.4;
    const o2 = Math.max(14, Math.min(21, O2 - adj));
    const co = Math.max(0, CO + i*2);
    const lel= Math.max(0, Math.min(20, LEL + (i-1)));
    const stateO2 = classify(o2, TH.O2);
    const stateCO = classify(co, TH.CO);
    const stateLEL= classify(lel, TH.LEL);
    const worst = ['ok','warn','danger'].findLast(x=>[stateO2,stateCO,stateLEL].includes(x));
    const v = `O₂ ${fmtPct(o2)} | CO ${fmtPpm(co)} | LEL ${fmtPct(lel)}`;
    $(`#val-${sensor.id}`).textContent = v;
    const st = $(`#state-${sensor.id}`);
    st.className = `sensor-state ${worst}`;
    st.textContent = worst.toUpperCase();
  });
}

function pushLog(line){
  const box = $('#alarmLogs');
  const row = document.createElement('div');
  row.textContent = `[${now().toLocaleTimeString()}] ${line}`;
  box.prepend(row);
}

function drawSpark(el, val, state){
  const pct = Math.max(0, Math.min(100, state==='low'?100-val:val));
  el.style.background = `linear-gradient(90deg, ${
    state==='danger'? 'rgba(255,77,79,.9)'
    : state==='warn'? 'rgba(255,176,32,.9)'
    : 'rgba(54,201,142,.9)'
  } ${pct}%, rgba(15,26,37,.6) ${pct}%)`;
}

function startMockStream(onReading){
  let O2 = 20.9, CO = 8, LEL = 2;
  setInterval(()=>{
    O2 += (Math.random()-.5)*0.2;
    CO += (Math.random()-.5)*4;
    LEL += (Math.random()-.5)*0.7;
    if(Math.random() < 0.05) CO += 40;
    if(Math.random() < 0.04) LEL += 4;
    if(Math.random() < 0.03) O2 -= 1.2;
    const reading = {O2, CO:Math.max(0,CO), LEL:Math.max(0,LEL)};
    onReading(reading);
  }, 1500);
}