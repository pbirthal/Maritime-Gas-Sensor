# backend/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, List
import uvicorn
import asyncio
import json
import os

# ---- Data models ----
class Reading(BaseModel):
    O2: float   # %
    CO: float   # ppm
    LEL: float  # %

class Tank(BaseModel):
    id: str

class Ship(BaseModel):
    id: str
    name: str
    tanks: List[Tank]

# ---- Static catalogue (keep in sync with frontend SHIPS) ----
SHIPS: Dict[str, Ship] = {
    "MANTA": Ship(id="MANTA", name="MT Great Manta",
                  tanks=[Tank(id="Cargo Tank 1"), Tank(id="HFO Tank"), Tank(id="MGO Tank"), Tank(id="FW Tank")]),
    "SEAHORSE": Ship(id="SEAHORSE", name="MV Seahorse",
                     tanks=[Tank(id="HFO Tank"), Tank(id="FW Tank")]),
    "KRISHNA": Ship(id="KRISHNA", name="INS Krishna",
                    tanks=[Tank(id="Ballast Tank"), Tank(id="FW Tank")]),
    "SINDHU": Ship(id="SINDHU", name="INS Sindhu",
                   tanks=[Tank(id="Cargo Tank 2")]),
}

# ---- Latest readings store ----
LATEST: Dict[str, Dict[str, Reading]] = { sid:{} for sid in SHIPS }

app = FastAPI(title="Maritime Gas API")

@app.get("/api/ships", response_model=List[Ship])
def list_ships():
    return list(SHIPS.values())

@app.get("/api/ships/{ship_id}/tanks", response_model=List[Tank])
def list_tanks(ship_id: str):
    ship = SHIPS.get(ship_id)
    if not ship: raise HTTPException(404, "Unknown ship")
    return ship.tanks

@app.get("/api/ships/{ship_id}/tanks/{tank_id}/readings/latest", response_model=Reading)
def latest_reading(ship_id: str, tank_id: str):
    ship = SHIPS.get(ship_id)
    if not ship: raise HTTPException(404, "Unknown ship")
    if tank_id not in [t.id for t in ship.tanks]:
        raise HTTPException(404, "Unknown tank")
    r = LATEST.get(ship_id, {}).get(tank_id)
    if not r: raise HTTPException(404, "No reading yet")
    return r

# ---- Optional: test injector (simulate a reading) ----
@app.post("/api/sim/{ship_id}/{tank_id}", response_model=Reading)
def inject(ship_id: str, tank_id: str, r: Reading):
    LATEST.setdefault(ship_id, {})[tank_id] = r
    return r

# ---- MQTT bridge (paho-mqtt) ----
MQTT_WS = os.getenv("MQTT_WS", "mqtt://localhost")   # broker for info only
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC = "ships/+/tanks/+/readings"

def start_mqtt():
    import paho.mqtt.client as mqtt
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    def on_connect(c, userdata, flags, reason_code, properties=None):
        print("MQTT connected", reason_code)
        c.subscribe(MQTT_TOPIC)
    def on_message(c, userdata, msg):
        try:
          payload = json.loads(msg.payload.decode())
          # topic: ships/{ship}/tanks/{tank}/readings
          parts = msg.topic.split("/")
          ship_id, tank_id = parts[1], parts[3]
          # normalize
          def num(v): 
              return v if isinstance(v,(int,float)) else v.get("value", 0.0)
          LATEST.setdefault(ship_id, {})[tank_id] = Reading(
              O2=float(num(payload.get("O2", 20.9))),
              CO=float(num(payload.get("CO", 0))),
              LEL=float(num(payload.get("LEL", 0))),
          )
        except Exception as e:
          print("Bad MQTT message:", e)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_start()
    return client

mqtt_client = None
@app.on_event("startup")
async def _boot():
    global mqtt_client
    mqtt_client = start_mqtt()
    print("Booted MQTT bridge -> REST latest")

@app.on_event("shutdown")
async def _shutdown():
    if mqtt_client:
        mqtt_client.loop_stop()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
