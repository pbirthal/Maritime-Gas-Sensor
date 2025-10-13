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

/* ========== Mock Data (replace with real feeds) ========== */
const SHIPS = [
  {
    id: 'MANTA',
    name: 'MT Great Manta',
    lastPort: 'Panama',
    arrived: '10:00 HRS',
    status: 'WIP',      // Idle | WIP | Danger
    personnel: 12,
    tanks: [
      { id:'Cargo Tank 1' },
      { id:'HFO Tank' },
      { id:'MGO Tank' },
      { id:'FW Tank' }
    ]
  },
  { id:'SEAHORSE', name:'MV Seahorse', lastPort:'Doha', arrived:'09:10 HRS', status:'WIP', personnel: 10, tanks:[{id:'HFO Tank'},{id:'FW Tank'}]},
  { id:'KRISHNA', name:'INS Krishna', lastPort:'Vizag', arrived:'08:40 HRS', status:'Idle', personnel: 8, tanks:[{id:'Ballast Tank'},{id:'FW Tank'}]},
  { id:'SINDHU', name:'INS Sindhu', lastPort:'Cochin', arrived:'07:55 HRS', status:'Danger', personnel: 14, tanks:[{id:'Cargo Tank 2'}]},
];

// thresholds
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
function initOverview(){
  // top stat numbers (mocked from list)
  $('#shipsAtDock').textContent = SHIPS.length.toString();
  $('#shipsUnderOp').textContent = SHIPS.filter(s=>s.status!=='Idle').length;
  $('#totalPersonnel').textContent = SHIPS.reduce((a,s)=>a+s.personnel,0);
  $('#spacesWarn').textContent = 1;
  $('#spacesDanger').textContent = SHIPS.filter(s=>s.status==='Danger').length;

  // status ships row (3 “lights”)
  const statuses = [
    {label:'Idle',       icon:'🚢', cls:'gray'},
    {label:'WIP',        icon:'🚢', cls:'ok'},
    {label:'WIP',        icon:'🚢', cls:'ok'},
    {label:'In Danger',  icon:'🚢', cls:'danger'},
  ];
  const row = $('#shipsRow');
  statuses.forEach(s=>{
    const card = document.createElement('div');
    card.className = 'ship-status';
    card.innerHTML = `
      <div class="ship-icon">${s.icon}</div>
      <div class="badge ${s.cls}">${s.label}</div>
    `;
    row.appendChild(card);
  });

  // list of active ships with ENTER buttons
  const list = $('#shipsList');
  SHIPS.forEach(ship=>{
    const el = document.createElement('div');
    el.className = 'shipcard';
    el.innerHTML = `
      <div class="shipmeta">
        <div class="shipname">${ship.name}</div>
        <div>Last Port: ${ship.lastPort}</div>
        <div>Arrived: ${ship.arrived}</div>
        <div>Status: <span class="badge ${badgeFor(ship.status)}">${ship.status}</span></div>
      </div>
      <a class="btn enter" href="ship.html?ship=${encodeURIComponent(ship.id)}">ENTER</a>
    `;
    list.appendChild(el);
  });

  // emergency modal
  const modal = $('#emModal');
  $('#btnEmergency').onclick = ()=> modal.classList.remove('hidden');
  $('#cancelEm').onclick = ()=> modal.classList.add('hidden');
  $('#confirmEm').onclick = ()=>{
    alert('🚨 Emergency Alarm broadcast to all ships & crews!');
    modal.classList.add('hidden');
  };
}

function badgeFor(s){
  if(s==='Danger') return 'danger';
  if(s==='WIP') return 'ok';
  return 'gray';
}

/* ========== Page 2 (Ship details) ========== */
function initShipPage(){
  const p = new URLSearchParams(location.search);
  const shipId = p.get('ship');
  const ship = SHIPS.find(s=>s.id===shipId) || SHIPS[0];

  $('#shipTitle').textContent = `Ship: ${ship.name}`;
  $('#totPersonnel').textContent = ship.personnel;
  $('#tankTitle').textContent = 'Avg. Readings — ' + ship.tanks[0].id;

  // side nav tanks
  const nav = $('#tankNav');
  ship.tanks.forEach((t,i)=>{
    const b = document.createElement('button');
    b.className = 'tankbtn' + (i===0?' active':'');
    b.textContent = t.id;
    b.onclick = ()=> selectTank(t.id);
    nav.appendChild(b);
  });

  // sensors grid (mock 4 sensors)
  renderSensors(4);

  // logs
  pushLog('System online. Awaiting readings…');

  // actions
  $('#ackBtn').onclick = ()=> pushLog('✅ Alarm acknowledged by user.');
  const evacModal = $('#evacModal');
  $('#evacBtn').onclick = ()=> evacModal.classList.remove('hidden');
  $('#evacCancel').onclick = ()=> evacModal.classList.add('hidden');
  $('#evacConfirm').onclick = ()=>{
    pushLog('🚨 Evacuation protocol initiated!');
    evacModal.classList.add('hidden');
  };

  // start mock stream (replace with real data)
  startMockStream((reading)=>{
    updateKpis(reading);
    updateSensors(reading);
  });

  function selectTank(name){
    $('#tankTitle').textContent = 'Avg. Readings — ' + name;
    $all('.tankbtn').forEach(b=>b.classList.remove('active'));
    [...nav.children].find(b=>b.textContent===name).classList.add('active');
    pushLog(`📦 Selected tank: ${name}`);
  }
}

/* ========== Rendering helpers (Ship page) ========== */
function renderSensors(n){
  const wrap = $('#sensorsWrap');
  wrap.innerHTML = '';
  for(let i=1;i<=n;i++){
    const tile = document.createElement('div');
    tile.className = 'sensor';
    tile.innerHTML = `
      <div class="sensor-top">
        <div class="sensor-id">S-${i.toString().padStart(2,'0')}</div>
        <div class="sensor-state ok" id="state-${i}">OK</div>
      </div>
      <div class="sensor-val" id="val-${i}">—</div>
      <div class="muted">CO / O₂ / LEL</div>
    `;
    wrap.appendChild(tile);
  }
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

  // Totals (example): update warning/danger counts
  const warn = (O2<=TH.O2.warn || CO>=TH.CO.warn || LEL>=TH.LEL.warn) ? 1 : 0;
  const dang = (O2<=TH.O2.danger || CO>=TH.CO.danger || LEL>=TH.LEL.danger) ? 1 : 0;
  $('#totWarn').textContent = warn;
  $('#totDanger').textContent = dang;
  if(dang){ pushLog('‼️ Threshold DANGER reached.'); }
}

function updateSensors({O2,CO,LEL}){
  for(let i=1;i<=4;i++){
    // simple distribution per sensor
    const adj = i===1?0:(i-1)*0.4;
    const o2 = Math.max(14, Math.min(21, O2 - adj));
    const co = Math.max(0, CO + i*2);
    const lel= Math.max(0, Math.min(20, LEL + (i-2)));

    const stateO2 = classify(o2, TH.O2);
    const stateCO = classify(co, TH.CO);
    const stateLEL= classify(lel, TH.LEL);
    const worst = ['ok','warn','danger'].findLast(x=>[stateO2,stateCO,stateLEL].includes(x));

    const v = `O₂ ${fmtPct(o2)} | CO ${fmtPpm(co)} | LEL ${fmtPct(lel)}`;
    $(`#val-${i}`).textContent = v;
    const st = $(`#state-${i}`);
    st.className = `sensor-state ${worst}`;
    st.textContent = worst.toUpperCase();
  }
}

function pushLog(line){
  const box = $('#alarmLogs');
  const row = document.createElement('div');
  row.textContent = `[${now().toLocaleTimeString()}] ${line}`;
  box.prepend(row);
}

/* Visual mini-spark (simple width-based bar) */
function drawSpark(el, val, state){
  const pct = Math.max(0, Math.min(100, state==='low'?100-val:val)); // not critical, visual only
  el.style.background = `linear-gradient(90deg, ${
    state==='danger'? 'rgba(255,77,79,.9)'
    : state==='warn'? 'rgba(255,176,32,.9)'
    : 'rgba(54,201,142,.9)'
  } ${pct}%, rgba(15,26,37,.6) ${pct}%)`;
}

/* ========== Streaming (Mock) ========== */
function startMockStream(onReading){
  let O2 = 20.9, CO = 8, LEL = 2;
  setInterval(()=>{
    // random walk
    O2 += (Math.random()-.5)*0.2;
    CO += (Math.random()-.5)*4;
    LEL += (Math.random()-.5)*0.7;

    // occasionally simulate events
    if(Math.random() < 0.05) CO += 40;
    if(Math.random() < 0.04) LEL += 4;
    if(Math.random() < 0.03) O2 -= 1.2;

    const reading = {O2, CO:Math.max(0,CO), LEL:Math.max(0,LEL)};
    onReading(reading);
  }, 1500);
}

/* ======== Hooks for REAL DATA ======== */
/*
TODO: wire real data here.
Example MQTT/WebSocket pseudo-code:

const ws = new WebSocket('wss://your-gateway');
ws.onmessage = (evt)=>{
  const msg = JSON.parse(evt.data);
  // expected: { type:'reading', tank:'HFO Tank', O2:19.4, CO:110, LEL:8.1, sensor:'S-03' }
  if(msg.type==='reading'){
    updateKpis(msg);
    updateSensors(msg);
  }
};

Or polling REST:
async function poll(){
  const r = await fetch('/api/ship/MANTA/tank/HFO/readings');
  const data = await r.json();
  updateKpis(data);
  updateSensors(data);
}
setInterval(poll, 1500);

You can also call updateShipStatus(shipId, 'Danger') for Page 1 status updates.
*/
