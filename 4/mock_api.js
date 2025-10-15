<!-- mock_api.js -->
<script>
/** Toggle on/off */
const ENABLE_MOCKS = true;

/** Keep original fetch to fall back when needed */
const _realFetch = window.fetch.bind(window);

/** Mini in-memory DB matching your schemas */
const MOCKDB = (() => {
  const now = () => new Date().toISOString();
  const shipId = "MTGREATMANTA";
  const tankId = 1;

  const ships = [{
    id: shipId, name: "MT Great Manta", lastPort: "Cochin", personnel: 12,
    status: "Idle", arrived: "10:30 HRS", previousStatus: null, image: null,
    live_o2: 20.9, live_co: 12, live_lel: 1.2, live_h2s: 0.3,
    tanks: [] /* ship list endpoint returns nested tanks via Pydantic */
  }];

  const tanks = [{
    id: tankId, ship_specific_id: "Tank-1", type_id: "BALLAST",
    ship_id: shipId, sensors: [{sensor_id: "SN-G-001"}]
  }];

  const masterSensors = [
    { id: "SN-G-001", type: "Multi-gas", status: "In Use", battery: 96,
      last_calibrated: new Date().toISOString().slice(0,10),
      last_used_on_ship: shipId, logs: []
    },
    { id: "SN-G-002", type: "Multi-gas", status: "Available", battery: 100,
      last_calibrated: new Date().toISOString().slice(0,10),
      last_used_on_ship: null, logs: []
    }
  ];

  const tankThresholds = {
    [tankId]: {
      warn_o2_low: 19.5, danger_o2_low: 18.0,
      warn_co_high: 35.0, danger_co_high: 100.0,
      warn_lel_high: 5.0, danger_lel_high: 10.0,
      warn_h2s_high: 10.0, danger_h2s_high: 15.0
    }
  };

  /** Live cache like your backend returns */
  const live = {
    [`${shipId}:${tankId}`]: {
      updated_at: new Date(),
      sensors: { "SN-G-001": { O2: 20.9, CO: 12, LEL: 1.2, H2S: 0.3 } },
      aggregates: {
        display: { O2: 20.9, CO: 12, LEL: 1.2, H2S: 0.3 },
        worst:   { O2: 20.9, CO: 12, LEL: 1.2, H2S: 0.3 }
      }
    }
  };

  /** Simple sparkline history */
  const readingArchive = Array.from({length: 20}).map((_,i) => {
    const ts = new Date(Date.now() - (20-i)*60000).toISOString();
    return { ts, ship_id: shipId, tank_id: tankId, O2: 20.7 + Math.random()*0.4, CO: 10+Math.random()*5, LEL: 0.8+Math.random()*0.8, H2S: 0.1+Math.random()*0.5 };
  });

  /** Event timeline logs (OK baseline) */
  const logs = [
    { timestamp: now(), ship_id: shipId, tank_id: tankId, severity: "OK", event: "OK", details: "[ship MTGREATMANTA tank 1] steady state" }
  ];

  return { ships, tanks, masterSensors, tankThresholds, live, readingArchive, logs };
})();

/** Utilities */
function jsonResponse(obj, status=200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function textResponse(text, status=200, type="text/plain") {
  return new Response(text, { status, headers: { "Content-Type": type } });
}

/** Router for mocked endpoints */
async function mockRouter(url, init) {
  const u = new URL(url, location.origin);
  const p = u.pathname;
  const m = (init?.method || "GET").toUpperCase();

  // Health
  if (p === "/api/health" || p === "/health") return jsonResponse({ ok: true, time: new Date().toISOString() });

  // SHIPS
  if (p === "/api/ships" && m === "GET") {
    // inject nested tanks for convenience
    const ships = MOCKDB.ships.map(s => ({
      ...s, tanks: MOCKDB.tanks.filter(t => t.ship_id === s.id)
        .map(t => ({ id: t.id, ship_specific_id: t.ship_specific_id, type_id: t.type_id, sensors: t.sensors }))
    }));
    return jsonResponse(ships);
  }
  if (p === "/api/ships" && m === "POST") {
    const body = JSON.parse(init.body || "{}");
    const id = body.name?.toUpperCase().replace(/ /g,"") || `SHIP${MOCKDB.ships.length+1}`;
    if (MOCKDB.ships.some(s => s.id === id)) return jsonResponse({ detail: "Ship with this ID already exists." }, 400);
    const row = {
      id, name: body.name || id, lastPort: body.lastPort || "—", personnel: body.personnel ?? 0,
      status: body.status || "Idle", arrived: "—", previousStatus: null, image: null,
      live_o2: null, live_co: null, live_lel: null, live_h2s: null, tanks: []
    };
    MOCKDB.ships.push(row);
    return jsonResponse(row);
  }
  // Acknowledge
  const ackMatch = p.match(/^\/api\/ships\/([^/]+)\/acknowledge$/);
  if (ackMatch && m === "PUT") {
    const ship = MOCKDB.ships.find(s => s.id === decodeURIComponent(ackMatch[1]));
    if (!ship) return jsonResponse({ detail: "Ship not found" }, 404);
    ship.status = ship.previousStatus || "Idle";
    ship.previousStatus = null;
    return jsonResponse(ship);
  }

  // TANKS
  const tankCreate = p.match(/^\/api\/ships\/([^/]+)\/tanks$/);
  if (tankCreate && m === "POST") {
    const ship_id = decodeURIComponent(tankCreate[1]);
    const ship = MOCKDB.ships.find(s => s.id === ship_id);
    if (!ship) return jsonResponse({ detail: "Ship not found." }, 404);
    const body = JSON.parse(init.body || "{}");
    if (!body.ship_specific_id && !body.type_id) return jsonResponse({ detail: "You must provide a Tank Type, a specific name, or both." }, 400);
    const id = (MOCKDB.tanks.reduce((mx,t)=>Math.max(mx,t.id),0) + 1) || 1;
    const row = { id, ship_specific_id: body.ship_specific_id || `Tank-${id}`, type_id: body.type_id || "BALLAST", ship_id, sensors: [] };
    MOCKDB.tanks.push(row);
    return jsonResponse({ id, ship_specific_id: row.ship_specific_id, type_id: row.type_id, sensors: [] });
  }

  // ASSIGN SENSORS TO TANK
  const assignMatch = p.match(/^\/api\/ships\/([^/]+)\/tanks\/(\d+)\/sensors$/);
  if (assignMatch && m === "POST") {
    const ship_id = decodeURIComponent(assignMatch[1]);
    const tank_id = +assignMatch[2];
    const tank = MOCKDB.tanks.find(t => t.id === tank_id && t.ship_id === ship_id);
    if (!tank) return jsonResponse({ detail: "Tank not found on this ship." }, 404);
    const body = JSON.parse(init.body || "{}");
    const ids = (body.sensor_ids || []);
    for (const sid of ids) {
      const ms = MOCKDB.masterSensors.find(s => s.id === sid);
      if (!ms) return jsonResponse({ detail: `Sensor '${sid}' not found.` }, 400);
      if (ms.status !== "Available" && ms.status !== "In Use") return jsonResponse({ detail: `Sensor '${sid}' is not available.` }, 400);
    }
    for (const sid of ids) {
      if (!tank.sensors.find(x => x.sensor_id === sid)) {
        tank.sensors.push({ sensor_id: sid });
      }
      const ms = MOCKDB.masterSensors.find(s => s.id === sid);
      ms.status = "In Use"; ms.last_used_on_ship = ship_id;
    }
    return jsonResponse(tank.sensors);
  }

  // THRESHOLDS
  const thrGet = p.match(/^\/api\/ships\/([^/]+)\/tanks\/(\d+)\/thresholds$/);
  if (thrGet && m === "GET") {
    const tank_id = +thrGet[2];
    return jsonResponse(MOCKDB.tankThresholds[tank_id] || {
      warn_o2_low: 19.5, danger_o2_low: 18.0,
      warn_co_high: 35.0, danger_co_high: 100.0,
      warn_lel_high: 5.0, danger_lel_high: 10.0,
      warn_h2s_high: 10.0, danger_h2s_high: 15.0
    });
  }
  if (thrGet && m === "PUT") {
    const tank_id = +thrGet[2];
    const body = JSON.parse(init.body || "{}");
    MOCKDB.tankThresholds[tank_id] = { ...MOCKDB.tankThresholds[tank_id], ...body };
    return jsonResponse(MOCKDB.tankThresholds[tank_id]);
  }

  // LIVE SNAPSHOT
  const liveMatch = p.match(/^\/api\/ships\/([^/]+)\/tanks\/(\d+)\/live$/);
  if (liveMatch && m === "GET") {
    const key = `${decodeURIComponent(liveMatch[1])}:${+liveMatch[2]}`;
    const bucket = MOCKDB.live[key] || { updated_at: null, sensors: {}, aggregates: { display: {O2:null,CO:null,LEL:null,H2S:null}, worst: {O2:null,CO:null,LEL:null,H2S:null} } };
    // convert Date to ISO for JSON
    return jsonResponse({
      ...bucket,
      updated_at: bucket.updated_at ? new Date(bucket.updated_at).toISOString() : null
    });
  }

  // READINGS (timeseries)
  const rdMatch = p.match(/^\/api\/ships\/([^/]+)\/tanks\/(\d+)\/readings$/);
  if (rdMatch && m === "GET") {
    const tank_id = +rdMatch[2];
    const data = MOCKDB.readingArchive
      .filter(r => r.tank_id === tank_id)
      .map(r => ({ ts: r.ts, O2: r.O2, CO: r.CO, LEL: r.LEL, H2S: r.H2S }));
    return jsonResponse(data);
  }

  // LOGS
  if (p === "/api/logs" && m === "GET") return jsonResponse(MOCKDB.logs);
  if (p === "/api/logs" && m === "POST") {
    const body = new URLSearchParams(u.search); // event & details could be in query, but we accept body too
    const payload = init?.body ? JSON.parse(init.body) : { event: body.get("event")||"Info", details: body.get("details")||"" };
    MOCKDB.logs.unshift({
      timestamp: new Date().toISOString(), ship_id: null, tank_id: null,
      severity: ["Danger","Warning","OK","Clear"].includes(payload.event) ? payload.event : "OK",
      event: payload.event, details: payload.details || ""
    });
    return jsonResponse({ ok: true });
  }

  // MASTER SENSORS (inventory)
  if (p === "/api/master/sensors" && m === "GET") return jsonResponse(MOCKDB.masterSensors);
  if (p === "/api/master/sensors" && m === "POST") {
    const body = JSON.parse(init.body || "{}");
    if (MOCKDB.masterSensors.some(s => s.id === body.id)) return jsonResponse({ detail: "A sensor with this ID already exists." }, 400);
    MOCKDB.masterSensors.push({
      id: body.id, type: body.type || "Multi-gas", status: body.status || "Available",
      battery: body.battery ?? 100, last_calibrated: body.last_calibrated || new Date().toISOString().slice(0,10),
      last_used_on_ship: body.last_used_on_ship || null, logs: []
    });
    return jsonResponse(MOCKDB.masterSensors.find(s=>s.id===body.id));
  }
  const msDetail = p.match(/^\/api\/master\/sensors\/([^/]+)$/);
  if (msDetail && m === "GET") {
    const s = MOCKDB.masterSensors.find(x => x.id === decodeURIComponent(msDetail[1]));
    return s ? jsonResponse(s) : jsonResponse({ detail: "Sensor not found" }, 404);
  }
  if (msDetail && m === "PUT") {
    const id = decodeURIComponent(msDetail[1]);
    const s = MOCKDB.masterSensors.find(x => x.id === id);
    if (!s) return jsonResponse({ detail: "Sensor not found" }, 404);
    Object.assign(s, JSON.parse(init.body || "{}"));
    return jsonResponse(s);
  }
  if (msDetail && m === "DELETE") {
    const id = decodeURIComponent(msDetail[1]);
    const tAssigned = MOCKDB.tanks.find(t => t.sensors.find(x => x.sensor_id === id));
    if (tAssigned) return jsonResponse({ detail: "Cannot delete: sensor is assigned to a tank. Unassign it first." }, 400);
    const idx = MOCKDB.masterSensors.findIndex(x => x.id === id);
    if (idx === -1) return jsonResponse({ detail: "Sensor not found" }, 404);
    MOCKDB.masterSensors.splice(idx,1);
    return jsonResponse({ ok: true });
  }
  const msLogsCsv = p.match(/^\/api\/master\/sensors\/([^/]+)\/logs\.csv$/);
  if (msLogsCsv && m === "GET") {
    const id = decodeURIComponent(msLogsCsv[1]);
    const rows = [["timestamp","event","details","sensor_id"],
      ...MOCKDB.logs.slice(0,20).map(l => [l.timestamp,l.event,l.details,id])];
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(",")).join("\n");
    return textResponse(csv, 200, "text/csv");
  }

  // Not mocked -> fall back to real fetch (lets you mix mock + real)
  return _realFetch(url, init);
}

/** Monkeypatch fetch */
window.fetch = async (input, init) => {
  if (!ENABLE_MOCKS) return _realFetch(input, init);
  const url = typeof input === "string" ? input : input.url;
  // Only intercept /api/* calls
  if (/^\/api(\/|$)/.test(url) || /\/health$/.test(url)) {
    try { return await mockRouter(url, init); }
    catch (e) { console.error("Mock router error:", e); return jsonResponse({ detail: "Mock error" }, 500); }
  }
  return _realFetch(input, init);
};
</script>
