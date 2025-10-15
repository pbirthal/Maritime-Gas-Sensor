# main.py

import datetime
from fastapi import FastAPI, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
import models, database
import json 
import threading
import paho.mqtt.client as mqtt
import os, io, csv
from fastapi.responses import StreamingResponse, JSONResponse


# --- In-memory live cache for quick UI reads (survives process lifetime) ---
# LIVE_CACHE[(ship_id, tank_id)] = {
#   "updated_at": datetime,
#   "sensors": { "<sensor_id>": {"O2": float|None, "CO": float|None, "LEL": float|None} },
#   "aggregates": {
#       "display": {"O2": float|None, "CO": float|None, "LEL": float|None},
#       "worst":   {"O2": float|None, "CO": float|None, "LEL": float|None}
#   }
# }
LIVE_CACHE = {}


# Create all database tables on startup
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()
allow_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_origins == "*" else [o.strip() for o in allow_origins.split(",")],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True, "time": datetime.datetime.now().isoformat()}

# --- NEW: Global default thresholds (used if per-tank thresholds not set) ---
DEFAULT_THRESHOLDS = {
    "warn_o2_low": 19.5,
    "danger_o2_low": 18.0,
    "warn_co_high": 35.0,
    "danger_co_high": 100.0,
    "warn_lel_high": 5.0,
    "danger_lel_high": 10.0,
    "warn_h2s_high": 10.0,
    "danger_h2s_high": 15.0,
}

def evaluate_state(o2, co, lel, h2s, t):
    """Return 'Danger' | 'Warning' | 'OK' based on thresholds dict t."""
    # danger first
    if (o2 is not None and o2 <= t["danger_o2_low"]) or \
       (co is not None and co >= t["danger_co_high"]) or \
       (lel is not None and lel >= t["danger_lel_high"]) or \
        (h2s is not None and h2s >= t["danger_h2s_high"]):
        return "Danger"
    # then warning
    if (o2 is not None and o2 <= t["warn_o2_low"]) or \
       (co is not None and co >= t["warn_co_high"]) or \
       (lel is not None and lel >= t["warn_lel_high"]) or \
        (h2s is not None and h2s >= t["warn_h2s_high"]):
        return "Warning"
    return "OK"

def _agg_from_sensors(sensors_dict):
    """Return display and worst-case aggregates from per-sensor readings."""
    o2s  = [v.get("O2")  for v in sensors_dict.values() if v.get("O2")  is not None]
    cos  = [v.get("CO")  for v in sensors_dict.values() if v.get("CO")  is not None]
    lels = [v.get("LEL") for v in sensors_dict.values() if v.get("LEL") is not None]
    h2s = [v.get("H2S") for v in sensors_dict.values() if v.get("H2S") is not None]

    def _max_or_none(arr): return max(arr) if arr else None
    def _min_or_none(arr): return min(arr) if arr else None

    display = {
        # what you want to *show* on the KPIs
        "O2":  _max_or_none(o2s),
        "CO":  _max_or_none(cos),
        "LEL": _max_or_none(lels),
        "H2S": _max_or_none(h2s),
    }
    worst = {
        # what we should use for safety state vs thresholds
        "O2":  _min_or_none(o2s),    # lower O2 is worse
        "CO":  _max_or_none(cos),    # higher CO is worse
        "LEL": _max_or_none(lels),   # higher LEL is worse
        "H2S": _max_or_none(h2s),   # higher H2S is worse
    }
    return display, worst


# --- Dependency to get DB session ---
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- One-time Data Seeding ---
@app.on_event("startup")
def boot():
    # db = database.SessionLocal()
    # # Check if data already exists to prevent re-seeding
    # if db.query(models.MasterTankType).first() is None:
    #     print("Seeding initial master tank types...")
    #     initial_tank_types = [
    #         models.MasterTankType(id="CARGO_LIQUID", name="Cargo Hold - Liquid Bulk", required_permits=["Confined Space Entry"]),
    #         models.MasterTankType(id="BALLAST", name="Ballast Tank"),
    #         models.MasterTankType(id="HFO", name="Heavy Fuel Oil (HFO) Tank", required_permits=["Hot Work"]),
    #     ]
    #     db.add_all(initial_tank_types)
    #     db.commit()

    # if db.query(models.MasterSensor).first() is None:
    #     print("Seeding initial master sensors...")
    #     initial_sensors = [
    #         models.MasterSensor(id="SN-G-001", type="Multi-gas", battery=98, logs=[models.SensorLogEntry(event="Commissioned", details="Device added to inventory.")]),
    #         models.MasterSensor(id="SN-G-002", type="Multi-gas", battery=95, status="In Use", last_used_on_ship="KRISHNA"),
    #         models.MasterSensor(id="SN-G-003", type="Multi-gas", status="Maintenance", battery=55),
    #         models.MasterSensor(id="CO-L-23B", type="CO", battery=100),
    #     ]
    #     db.add_all(initial_sensors)
    #     db.commit()
    # db.close()
    # This ensures the MQTT client starts when the FastAPI app starts
    mqtt_thread = threading.Thread(target=start_mqtt_client)
    mqtt_thread.daemon = True
    mqtt_thread.start()


# --- MASTER DATA ENDPOINTS ---
@app.get("/api/master/sensors", response_model=list[models.MasterSensorSchema], tags=["Master Data"])
def get_master_sensor_list(db: Session = Depends(get_db)):
    return db.query(models.MasterSensor).all()

# Ensure you already have this (detail). If not, add it:
@app.get("/api/master/sensors/{sensor_id}", response_model=models.MasterSensorSchema, tags=["Master Data"])
def get_sensor_detail(sensor_id: str, db: Session = Depends(get_db)):
    sensor = db.query(models.MasterSensor).filter(models.MasterSensor.id == sensor_id).first()
    if not sensor:
        raise HTTPException(404, "Sensor not found")
    return sensor

# NEW: CSV download of a sensor's event logs
@app.get("/api/master/sensors/{sensor_id}/logs.csv")
def download_sensor_logs(sensor_id: str, db: Session = Depends(get_db)):
    sensor = db.query(models.MasterSensor).filter(models.MasterSensor.id == sensor_id).first()
    if not sensor:
        raise HTTPException(404, "Sensor not found")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["timestamp","event","details","sensor_id"])
    for log in sensor.logs:
        writer.writerow([log.timestamp.isoformat(), log.event, log.details, sensor.id])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{sensor_id}_logs.csv"'}
    )

@app.get("/api/master/tank-types", response_model=list[models.MasterTankTypeSchema], tags=["Master Data"])
def get_master_tank_types(db: Session = Depends(get_db)):
    return db.query(models.MasterTankType).all()

# --- SHIP ENDPOINTS ---
@app.get("/api/ships", response_model=list[models.ShipSchema], tags=["Ships"])
def get_all_ships(db: Session = Depends(get_db)):
    return db.query(models.Ship).all()

@app.post("/api/ships", response_model=models.ShipSchema, tags=["Ships"])
def create_ship(ship: models.ShipCreate, db: Session = Depends(get_db)):
    # --- NEW: Generate the ID on the backend ---
    ship_id = ship.name.upper().replace(" ", "")
    # ----------------------------------------

    db_ship = db.query(models.Ship).filter(models.Ship.id == ship_id).first()
    if db_ship:
        raise HTTPException(status_code=400, detail="Ship with this ID already exists.")
    
    new_ship = models.Ship(
        **ship.dict(),
        id=ship_id, # <-- Use the generated ID
        arrived=datetime.datetime.now().strftime("%H:%M HRS")
    )
    db.add(new_ship)
    db.commit()
    db.refresh(new_ship)
    return new_ship
# ... (All your other ship endpoints: update, delete, acknowledge remain the same)

# --- TANK & SENSOR ENDPOINTS ---
@app.post("/api/ships/{ship_id}/tanks", response_model=models.TankSchema, tags=["Tanks"])
def create_tank_for_ship(ship_id: str, tank: models.TankCreate, db: Session = Depends(get_db)):
    db_ship = db.query(models.Ship).filter(models.Ship.id == ship_id).first()
    if not db_ship:
        raise HTTPException(status_code=404, detail="Ship not found.")
    
    # --- NEW: Validation Logic ---
    # Ensure at least one identifier is provided.
    if not tank.ship_specific_id and not tank.type_id:
        raise HTTPException(status_code=400, detail="You must provide a Tank Type, a specific name, or both.")

    # If the user provides a custom name, check if it's already used on this ship.
    if tank.ship_specific_id:
        existing_tank = db.query(models.Tank).filter(
            models.Tank.ship_id == ship_id,
            models.Tank.ship_specific_id == tank.ship_specific_id
        ).first()
        if existing_tank:
            raise HTTPException(status_code=400, detail=f"A tank with the name '{tank.ship_specific_id}' already exists on this ship.")
    # -----------------------------
        
    new_tank = models.Tank(**tank.dict(), ship_id=ship_id)
    db.add(new_tank)
    db.commit()
    db.refresh(new_tank)
    return new_tank

@app.post("/api/ships/{ship_id}/tanks/{tank_id}/sensors", response_model=list[models.AssignedSensorSchema], tags=["Sensors"])
def assign_sensors_to_tank(ship_id: str, tank_id: int, request: models.SensorAssignRequest, db: Session = Depends(get_db)):
    db_tank = db.query(models.Tank).filter(models.Tank.id == tank_id, models.Tank.ship_id == ship_id).first()
    if not db_tank:
        raise HTTPException(status_code=404, detail="Tank not found on this ship.")
    
    for sensor_id in request.sensor_ids:
        db_sensor = db.query(models.MasterSensor).filter(models.MasterSensor.id == sensor_id).first()
        if not db_sensor:
            raise HTTPException(status_code=400, detail=f"Sensor '{sensor_id}' not found.")
        if db_sensor.status != "Available":
            raise HTTPException(status_code=400, detail=f"Sensor '{sensor_id}' is not available.")

    for sensor_id in request.sensor_ids:
        # Assign sensor
        new_assignment = models.AssignedSensor(sensor_id=sensor_id, tank_id=tank_id)
        db.add(new_assignment)
        # Update master sensor status
        db_sensor = db.query(models.MasterSensor).filter(models.MasterSensor.id == sensor_id).first()
        db_sensor.status = "In Use"
        db_sensor.last_used_on_ship = db_tank.owner_ship.name
    
    db.commit()
    # Return all sensors now assigned to the tank
    db.refresh(db_tank)
    return db_tank.sensors

@app.get("/api/ships/{ship_id}/tanks/{tank_id}/thresholds", response_model=models.TankThresholdSchema)
def get_tank_thresholds(ship_id: str, tank_id: int, db: Session = Depends(get_db)):
    tank = db.query(models.Tank).filter(models.Tank.id==tank_id, models.Tank.ship_id==ship_id).first()
    if not tank:
        raise HTTPException(404, "Tank not found")
    row = db.query(models.TankThreshold).filter(models.TankThreshold.tank_id==tank_id).first()
    # fill with defaults if not set
    if not row:
        return models.TankThresholdSchema(**DEFAULT_THRESHOLDS)
    data = {k: getattr(row, k) if getattr(row, k) is not None else DEFAULT_THRESHOLDS[k] for k in DEFAULT_THRESHOLDS}
    return models.TankThresholdSchema(**data)

@app.put("/api/ships/{ship_id}/tanks/{tank_id}/thresholds", response_model=models.TankThresholdSchema)
def put_tank_thresholds(ship_id: str, tank_id: int, payload: models.TankThresholdSchema, db: Session = Depends(get_db)):
    tank = db.query(models.Tank).filter(models.Tank.id==tank_id, models.Tank.ship_id==ship_id).first()
    if not tank:
        raise HTTPException(404, "Tank not found")
    row = db.query(models.TankThreshold).filter(models.TankThreshold.tank_id==tank_id).first()
    if not row:
        row = models.TankThreshold(tank_id=tank_id)
        db.add(row)
    for k, v in payload.dict().items():
        setattr(row, k, v)
    db.commit(); db.refresh(row)
    data = {k: getattr(row, k) if getattr(row, k) is not None else DEFAULT_THRESHOLDS[k] for k in DEFAULT_THRESHOLDS}
    return models.TankThresholdSchema(**data)

@app.get("/api/ships/{ship_id}/tanks/{tank_id}/live")
def get_tank_live(ship_id: str, tank_id: int):
    key = (ship_id, tank_id)
    bucket = LIVE_CACHE.get(key)
    if not bucket:
        return {
            "updated_at": None,
            "sensors": {},
            "aggregates": {"display": {"O2": None, "CO": None, "LEL": None, "H2S": None},
                           "worst":   {"O2": None, "CO": None, "LEL": None, "H2S": None}}
        }
    return bucket


@app.put("/api/ships/{ship_id}/acknowledge", response_model=models.ShipSchema)
def acknowledge_alarm(ship_id: str, db: Session = Depends(get_db)):
    ship = db.query(models.Ship).filter(models.Ship.id == ship_id).first()
    if not ship:
        raise HTTPException(404, "Ship not found")
    ship.status = ship.previousStatus or "Idle"
    db.commit(); db.refresh(ship)
    return ship

# === Event timeline & readings API ===


@app.get("/api/logs", tags=["Logs"])
def get_logs(ship_id: str | None = None,
             severity: str | None = None,
             tank_id: int | None = None,
             minutes: int = Query(60, ge=1, le=10080),
             db: Session = Depends(get_db)):
    """
    Returns recent event logs (Safety/User/Config). For demo we reuse SensorLogEntry.
    We'll interpret event names: Danger/Warning/OK/Clear plus any UI action events.
    """
    cutoff = datetime.datetime.now() - datetime.timedelta(minutes=minutes)
    q = db.query(models.SensorLogEntry).filter(models.SensorLogEntry.timestamp >= cutoff)
    # ship_id/tank_id embedded in details if coming from MQTT or UI; filter best-effort
    # Example details format recommendation: "[ship MTGREATMANTA tank 1] ... "
    rows = q.order_by(models.SensorLogEntry.timestamp.desc()).all()
    payload = []
    for r in rows:
        sev = None
        if r.event in ("Danger", "Warning", "OK", "Clear"):
            sev = "Danger" if r.event == "Danger" else ("Warning" if r.event == "Warning" else "OK")
        # quick text parsing (non-fatal if not present)
        s_id, t_id = None, None
        txt = r.details or ""
        # crude parse like: "[tank 3]" or "[ship MT.. tank 2]"
        try:
            if "ship " in txt:
                s_id = txt.split("ship ")[1].split(" ")[0].strip("[]:,")
            if "tank " in txt:
                t_id = int(txt.split("tank ")[1].split("]")[0].split()[0].strip("[]:,"))
        except Exception:
            pass
        if ship_id and s_id and s_id != ship_id: 
            continue
        if tank_id is not None and t_id is not None and t_id != tank_id:
            continue
        if severity and sev and sev != severity:
            continue
        payload.append({
            "timestamp": r.timestamp.isoformat(),
            "ship_id": s_id,
            "tank_id": t_id,
            "severity": sev,
            "event": r.event,
            "details": r.details
        })
    return payload

@app.post("/api/logs", tags=["Logs"])
def post_log(event: str, details: str = "", db: Session = Depends(get_db)):
    """
    Allows UI to append user/audit events into the same log sink.
    """
    any_sensor = db.query(models.MasterSensor).first()
    if not any_sensor:
        raise HTTPException(400, "No sensor sink available to attach log")
    entry = models.SensorLogEntry(owner_sensor=any_sensor, event=event, details=details)
    db.add(entry); db.commit()
    return {"ok": True}

@app.get("/api/ships/{ship_id}/tanks/{tank_id}/readings", tags=["Readings"])
def get_readings(ship_id: str, tank_id: int, minutes: int = Query(60, ge=1, le=1440), db: Session = Depends(get_db)):
    cutoff = datetime.datetime.now() - datetime.timedelta(minutes=minutes)
    rows = (db.query(models.ReadingArchive)
              .filter(models.ReadingArchive.ship_id==ship_id,
                      models.ReadingArchive.tank_id==tank_id,
                      models.ReadingArchive.timestamp >= cutoff)
              .order_by(models.ReadingArchive.timestamp.asc())
              .all())
    return [{"ts": r.timestamp.isoformat(), "O2": r.o2, "CO": r.co, "LEL": r.lel,"H2S": r.h2s} for r in rows]

# --- SENSOR INVENTORY CRUD ---

VALID_SENSOR_STATUS = {"Available", "Maintenance"}  # "In Use" is managed by assignment

@app.post("/api/master/sensors", response_model=models.MasterSensorSchema, tags=["Master Data"])
def create_master_sensor(payload: models.MasterSensorCreate, db: Session = Depends(get_db)):
    if db.query(models.MasterSensor).filter(models.MasterSensor.id == payload.id).first():
        raise HTTPException(400, "A sensor with this ID already exists.")
    if payload.status not in VALID_SENSOR_STATUS:
        raise HTTPException(400, "Invalid status. Allowed: Available, Maintenance.")
    if not (0 <= payload.battery <= 100):
        raise HTTPException(400, "Battery must be between 0 and 100.")
    row = models.MasterSensor(
        id=payload.id,
        type=payload.type,
        status=payload.status,
        battery=payload.battery,
        last_calibrated=payload.last_calibrated or datetime.date.today(),
        last_used_on_ship=payload.last_used_on_ship
    )
    db.add(row); db.commit(); db.refresh(row)
    return row

@app.put("/api/master/sensors/{sensor_id}", response_model=models.MasterSensorSchema, tags=["Master Data"])
def update_master_sensor(sensor_id: str, payload: models.MasterSensorUpdate, db: Session = Depends(get_db)):
    row = db.query(models.MasterSensor).filter(models.MasterSensor.id == sensor_id).first()
    if not row:
        raise HTTPException(404, "Sensor not found")

    # guardrails
    if payload.status is not None:
        if payload.status not in VALID_SENSOR_STATUS:
            raise HTTPException(400, "Invalid status. Use Available or Maintenance. 'In Use' is set by assignment.")
        row.status = payload.status
    if payload.type is not None:
        row.type = payload.type
    if payload.battery is not None:
        if not (0 <= payload.battery <= 100):
            raise HTTPException(400, "Battery must be between 0 and 100.")
        row.battery = payload.battery
    if payload.last_calibrated is not None:
        row.last_calibrated = payload.last_calibrated
    if payload.last_used_on_ship is not None:
        row.last_used_on_ship = payload.last_used_on_ship

    db.commit(); db.refresh(row)
    return row

@app.delete("/api/master/sensors/{sensor_id}", tags=["Master Data"])
def delete_master_sensor(sensor_id: str, db: Session = Depends(get_db)):
    row = db.query(models.MasterSensor).filter(models.MasterSensor.id == sensor_id).first()
    if not row:
        raise HTTPException(404, "Sensor not found")

    # Block delete if assigned to any tank
    assigned = db.query(models.AssignedSensor).filter(models.AssignedSensor.sensor_id == sensor_id).first()
    if assigned:
        raise HTTPException(400, "Cannot delete: sensor is assigned to a tank. Unassign it first.")

    # cascade deletes its logs via relationship
    db.delete(row); db.commit()
    return {"ok": True}

@app.post("/api/master/sensors/{sensor_id}/calibrate", response_model=models.MasterSensorSchema, tags=["Master Data"])
def calibrate_master_sensor(sensor_id: str, db: Session = Depends(get_db)):
    row = db.query(models.MasterSensor).filter(models.MasterSensor.id == sensor_id).first()
    if not row:
        raise HTTPException(404, "Sensor not found")
    row.last_calibrated = datetime.date.today()
    db.commit(); db.refresh(row)
    return row



# ===================================================================
# ========== MQTT INTEGRATION SECTION ============
# ===================================================================

MQTT_BROKER = "localhost"
MQTT_PORT = 1883
TOPIC = "ship/+/sensors"

# This is the helper function to get a database session inside the MQTT thread.
# It's crucial because the main `get_db` is tied to API requests.
def get_db_for_mqtt():
    return database.SessionLocal()

def on_connect(client, userdata, flags, rc):
    print(f"Connected to MQTT Broker with result code {rc}")
    client.subscribe(TOPIC)

def on_message(client, userdata, msg): 
    
    db = get_db_for_mqtt()
    try:
        parts = msg.topic.split('/')
        if len(parts) < 3 or parts[0] != 'ship' or parts[2] != 'sensors':
            return
        ship_id = parts[1]
        data = json.loads(msg.payload.decode())
        tank_id = data.get("tank_id")
        readings = data.get("readings") or []

        ship = db.query(models.Ship).filter(models.Ship.id == ship_id).first()
        if not ship or tank_id is None:
            return

        # ensure tank exists for this ship
        tank = db.query(models.Tank).filter(models.Tank.id == tank_id, models.Tank.ship_id == ship_id).first()
        if not tank:
            return

        # Build allowed sensor set for this tank
        assigned_ids = {a.sensor_id for a in tank.sensors}

        # If you want to strictly require assignment, drop unassigned
        filtered = []
        for r in readings:
            sid = r.get("sensor_id")
            if not sid or sid not in assigned_ids:
                # ignore unassigned sensor data
                continue
            filtered.append(r)

        if not filtered:
            return  # nothing valid to ingest

        key = (ship_id, tank_id)
        bucket = LIVE_CACHE.get(key, {"sensors": {}, "aggregates": {}})

        for r in filtered:
            sid = r.get("sensor_id")
            bucket["sensors"][sid] = {
                "O2": r.get("O2"), "CO": r.get("CO"),
                "LEL": r.get("LEL"), "H2S": r.get("H2S")
            }
            db.add(models.ReadingArchive(
                ship_id=ship_id, tank_id=tank_id,
                o2=r.get("O2"), co=r.get("CO"), lel=r.get("LEL"), h2s=r.get("H2S")
            ))

        disp, worst = _agg_from_sensors(bucket["sensors"])
        bucket["aggregates"] = {"display": disp, "worst": worst}
        bucket["updated_at"] = datetime.datetime.now()
        LIVE_CACHE[key] = bucket

        # Load per-tank thresholds if any, else defaults
        T = DEFAULT_THRESHOLDS.copy()
        thr = db.query(models.TankThreshold).filter(models.TankThreshold.tank_id == tank_id).first()
        if thr:
            for k in T.keys():
                v = getattr(thr, k, None)
                if v is not None:
                    T[k] = v

        new_state = evaluate_state(worst.get("O2"), worst.get("CO"), worst.get("LEL"), worst.get("H2S"), T)
        prev = ship.status or "Idle"

        ship.live_o2, ship.live_co, ship.live_lel, ship.live_h2s = disp.get("O2"), disp.get("CO"), disp.get("LEL"), disp.get("H2S")

        sink = db.query(models.MasterSensor).filter(models.MasterSensor.type=="Multi-gas").first()
        def log_event(ev, details):
            if sink:
                db.add(models.SensorLogEntry(owner_sensor=sink, event=ev, details=details))

        if new_state == "Danger" and prev != "Danger":
            ship.previousStatus = ship.status
            ship.status = "Danger"
            log_event("Danger", f"[ship {ship_id} tank {tank_id}] worst O2={worst.get('O2')}, CO={worst.get('CO')}, LEL={worst.get('LEL')}, H2S={worst.get('H2S')}")
        elif new_state == "Warning" and prev not in ("Danger","Warning"):
            ship.status = "Warning"
            log_event("Warning", f"[ship {ship_id} tank {tank_id}] worst O2={worst.get('O2')}, CO={worst.get('CO')}, LEL={worst.get('LEL')}, H2S={worst.get('H2S')}")
        elif new_state == "OK" and prev in ("Danger","Warning"):
            log_event("Clear", f"[ship {ship_id} tank {tank_id}] recovered; worst O2={worst.get('O2')}, CO={worst.get('CO')}, LEL={worst.get('LEL')}, H2S={worst.get('H2S')}")

        db.commit()
    except Exception as e:
        print(f"Error processing MQTT message: {e}")
    finally:
        db.close()


# def on_message(client, userdata, msg):
#     print(f"Received message on topic {msg.topic}: {msg.payload.decode()}")
#     db = get_db_for_mqtt()
#     try:
#         # topic: ship/<SHIP_ID>/sensors
#         parts = msg.topic.split('/')
#         if len(parts) < 3 or parts[0] != 'ship' or parts[2] != 'sensors':
#             return
#         ship_id = parts[1]

#         data = json.loads(msg.payload.decode())
#         # expected payload (multi-sensor):
#         # {
#         #   "tank_id": 1,
#         #   "readings": [
#         #     {"sensor_id": "S1", "O2": 21.0, "CO": 10.0, "LEL": 1.0},
#         #     {"sensor_id": "S2", "O2": 20.0, "CO": 12.0, "LEL": 0.5},
#         #     ...
#         #   ]
#         # }
#         tank_id = data.get("tank_id")
#         readings = data.get("readings") or []

#         ship = db.query(models.Ship).filter(models.Ship.id == ship_id).first()
#         if not ship:
#             return

#         # 1) Update LIVE_CACHE per sensor
#         key = (ship_id, tank_id)
#         bucket = LIVE_CACHE.get(key, {"sensors": {}, "aggregates": {}})
#         for r in readings:
#             sid = r.get("sensor_id")
#             if not sid: 
#                 continue
#             # normalize numeric fields
#             bucket["sensors"][sid] = {"O2": r.get("O2"), "CO": r.get("CO"), "LEL": r.get("LEL"), "H2S": r.get("H2S")}
#             # 2) Archive each sensor reading (optional but useful)
#             db.add(models.ReadingArchive(
#                 ship_id=ship_id, tank_id=tank_id,
#                 o2=r.get("O2"), co=r.get("CO"), lel=r.get("LEL"), h2s=r.get("H2S")
#             ))
#         disp, worst = _agg_from_sensors(bucket["sensors"])
#         bucket["aggregates"] = {"display": disp, "worst": worst}
#         bucket["updated_at"] = datetime.datetime.now()
#         LIVE_CACHE[key] = bucket

#         # 3) Resolve thresholds (per-tank overrides if any)
#         T = DEFAULT_THRESHOLDS.copy()
#         if tank_id is not None:
#             thr = db.query(models.TankThreshold).filter(models.TankThreshold.tank_id == tank_id).first()
#             if thr:
#                 for k in T.keys():
#                     v = getattr(thr, k, None)
#                     if v is not None:
#                         T[k] = v

#         # 4) Use WORST aggregate to evaluate safety (correct severity)
#         new_state = evaluate_state(worst.get("O2"), worst.get("CO"), worst.get("LEL"), worst.get("H2S"), T)
#         prev = ship.status or "Idle"

#         # 5) Put DISPLAY aggregate on ship.live_* so your current UI shows the overview
#         ship.live_o2  = disp.get("O2")
#         ship.live_co  = disp.get("CO")
#         ship.live_lel = disp.get("LEL")
#         ship.live_h2s = disp.get("H2S")

#         # 6) Log transitions + set ship status (ack still required to clear Danger)
#         sink = db.query(models.MasterSensor).filter(models.MasterSensor.type=="Multi-gas").first()
#         def log_event(ev, details):
#             if sink:
#                 db.add(models.SensorLogEntry(owner_sensor=sink, event=ev, details=details))

#         if new_state == "Danger" and prev != "Danger":
#             ship.previousStatus = ship.status
#             ship.status = "Danger"
#             log_event("Danger", f"[tank {tank_id}] worst O2={worst.get('O2')}, CO={worst.get('CO')}, LEL={worst.get('LEL')}, H2S={worst.get('H2S')}")
#         elif new_state == "Warning" and prev not in ("Danger","Warning"):
#             ship.status = "Warning"
#             log_event("Warning", f"[tank {tank_id}] worst O2={worst.get('O2')}, CO={worst.get('CO')}, LEL={worst.get('LEL')}, H2S={worst.get('H2S')}")
#         elif new_state == "OK" and prev in ("Danger","Warning"):
#             log_event("Clear", f"[tank {tank_id}] recovered; worst O2={worst.get('O2')}, CO={worst.get('CO')}, LEL={worst.get('LEL')}, H2S={worst.get('H2S')}")

#         db.commit()
#     except Exception as e:
#         print(f"Error processing MQTT message: {e}")
#     finally:
#         db.close()

    # print(f"Received message on topic {msg.topic}: {msg.payload.decode()}")
    # db = get_db_for_mqtt()
    # try:
    #     # topic pattern: ship/<SHIP_ID>/sensors
    #     parts = msg.topic.split('/')
    #     if len(parts) < 3 or parts[0] != 'ship' or parts[2] != 'sensors':
    #         return
    #     ship_id = parts[1]

    #     data = json.loads(msg.payload.decode())  # expected keys: O2, CO, LEL

    #     ship = db.query(models.Ship).filter(models.Ship.id == ship_id).first()
    #     if not ship:
    #         # unknown ship id; ignore
    #         return

    #     # 1) Update live values
    #     ship.live_o2 = data.get("O2")
    #     ship.live_co = data.get("CO")
    #     ship.live_lel = data.get("LEL")

    #     # 2) Archive the reading (for charts/exports later)
    #     db.add(models.ReadingArchive(
    #         ship_id=ship_id,
    #         tank_id=None,  # optional: bind per tank if you route by tank topic later
    #         o2=ship.live_o2, co=ship.live_co, lel=ship.live_lel
    #     ))

    #     # 3) Resolve thresholds — for now global defaults (per-tank if you later route by tank)
    #     t = DEFAULT_THRESHOLDS
    #     new_state = evaluate_state(ship.live_o2, ship.live_co, ship.live_lel, t)
    #     prev_state = ship.status or "Idle"

    #     # 4) Generate logs on transitions (attach to any 'Multi-gas' sensor as a global log sink)
    #     log_sensor = db.query(models.MasterSensor).filter(models.MasterSensor.type == "Multi-gas").first()

    #     def log_event(event, details):
    #         if log_sensor:
    #             db.add(models.SensorLogEntry(
    #                 owner_sensor=log_sensor, event=event, details=details
    #             ))

    #     if new_state == "Danger" and prev_state != "Danger":
    #         ship.previousStatus = ship.status
    #         ship.status = "Danger"
    #         log_event("Danger", f"O2={ship.live_o2}, CO={ship.live_co}, LEL={ship.live_lel}")
    #     elif new_state == "Warning" and prev_state not in ("Danger", "Warning"):
    #         # keep operational status but log warning
    #         log_event("Warning", f"O2={ship.live_o2}, CO={ship.live_co}, LEL={ship.live_lel}")
    #     elif new_state == "OK" and prev_state in ("Danger","WIP","Warning"):
    #         log_event("Clear", f"Recovered O2={ship.live_o2}, CO={ship.live_co}, LEL={ship.live_lel}")
    #         # don't auto-flip status from Danger; wait for /acknowledge

    #     db.commit()
    # except Exception as e:
    #     print(f"Error processing MQTT message: {e}")
    # finally:
    #     db.close()

# def on_message(client, userdata, msg):
#     """
#     This function is called for every MQTT message.
#     It now finds the ship in the database and updates its live readings.
#     """
#     print(f"Received message on topic {msg.topic}: {msg.payload.decode()}")
#     db = get_db_for_mqtt()
#     try:
#         ship_id = msg.topic.split('/')[1]
#         data = json.loads(msg.payload.decode())

#         # Find the ship in the database
#         db_ship = db.query(models.Ship).filter(models.Ship.id == ship_id).first()

#         if db_ship:
#             # Update live sensor readings in the database
#             db_ship.live_o2 = data.get("O2")
#             db_ship.live_co = data.get("CO")
#             db_ship.live_lel = data.get("LEL")

#             # Check for danger conditions
#             is_danger = (
#                 data.get("CO", 0) >= 100 or
#                 data.get("LEL", 0) >= 10 or
#                 (data.get("O2", 21) <= 18 and data.get("O2") is not None)
#             )
#             if is_danger and db_ship.status != "Danger":
#                 print(f"!!! DANGER DETECTED for ship {ship_id} !!!")
#                 db_ship.previousStatus = db_ship.status
#                 db_ship.status = "Danger"
            
#             # Save all changes to the database
#             db.commit()

#     except Exception as e:
#         print(f"Error processing MQTT message: {e}")
#     finally:
#         # Always close the session
#         db.close()

# --- SETUP AND START MQTT CLIENT IN A BACKGROUND THREAD ---
mqtt_client = mqtt.Client()
mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

def start_mqtt_client():
    mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
    mqtt_client.loop_forever()
