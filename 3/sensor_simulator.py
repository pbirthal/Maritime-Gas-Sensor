# sensor_simulator.py  — multi-sensor, per-tank payload

import paho.mqtt.client as mqtt
import time
import json
import random

# --------- Config ---------
MQTT_BROKER = "localhost"
MQTT_PORT   = 1883

SHIP_ID = "MTGREATMANTA"   # must match a real ship id in your DB
TANK_ID = 1                # set to an existing tank's integer id for that ship

# Simulate these sensors inside the tank (IDs should match or be assignable)
SENSORS = ["SN-G-001", "CO-L-23B", "S3"]

PUBLISH_TOPIC = f"ship/{SHIP_ID}/sensors"
INTERVAL_SEC  = 3

# Starting baselines (per sensor) and step magnitudes
O2_BASE,  O2_STEP  = 20.9, 0.20    # O2 around 20–21%, small drift
CO_BASE,  CO_STEP  = 8.0,  4.0     # CO around single digits, drift a few ppm
LEL_BASE, LEL_STEP = 2.0,  0.7     # LEL a few %, drift a bit

# 10% chance per tick to spike CO to a dangerous level for one random sensor
DANGER_PROB     = 0.10
CO_DANGER_SPIKE = 110.0

# --------- MQTT client ---------
client = mqtt.Client()

def connect_mqtt():
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()

# --------- Simulation state ---------
# keep per-sensor random-walk state so it looks natural tick-to-tick
_state = {
    sid: {
        "O2":  O2_BASE + random.uniform(-0.2, 0.2),
        "CO":  CO_BASE + random.uniform(-2, 2),
        "LEL": LEL_BASE + random.uniform(-0.5, 0.5),
    }
    for sid in SENSORS
}

def _clamp(v, lo=None, hi=None):
    if lo is not None: v = max(lo, v)
    if hi is not None: v = min(hi, v)
    return v

def _tick_sensor(prev):
    """do one random-walk tick for a single sensor"""
    o2  = prev["O2"]  + (random.random() - 0.5) * O2_STEP
    co  = prev["CO"]  + (random.random() - 0.5) * CO_STEP
    lel = prev["LEL"] + (random.random() - 0.5) * LEL_STEP

    # clamp to sane ranges
    o2  = _clamp(o2, 14.0, 21.0)   # never above 21, never below 14
    co  = _clamp(co, 0.0, 200.0)
    lel = _clamp(lel, 0.0, 100.0)

    return {"O2": o2, "CO": co, "LEL": lel}

def publish_sensor_data():
    tick = 0
    while True:
        tick += 1

        # Randomly choose one sensor to spike CO (danger) this tick
        spiked_sensor = None
        if random.random() < DANGER_PROB:
            spiked_sensor = random.choice(SENSORS)

        readings = []
        for sid in SENSORS:
            # random walk
            _state[sid] = _tick_sensor(_state[sid])

            # optional spike for this sensor
            if sid == spiked_sensor:
                print(f">>> SIMULATING DANGER EVENT on {sid}! CO spike!")
                _state[sid]["CO"] = CO_DANGER_SPIKE

            # snapshot & round for publishing
            o2  = round(_state[sid]["O2"],  2)
            co  = round(_state[sid]["CO"],  2)
            lel = round(_state[sid]["LEL"], 2)

            readings.append({"sensor_id": sid, "O2": o2, "CO": co, "LEL": lel})

            # after publishing a spike, let CO relax a bit next tick
            if _state[sid]["CO"] > 100:
                _state[sid]["CO"] = CO_BASE

        payload = json.dumps({"tank_id": TANK_ID, "readings": readings})
        result = client.publish(PUBLISH_TOPIC, payload, qos=1)
        status = result[0]
        if status == 0:
            print(f"Sent {payload} -> {PUBLISH_TOPIC}")
        else:
            print(f"Failed to send message to topic {PUBLISH_TOPIC}")

        time.sleep(INTERVAL_SEC)

if __name__ == '__main__':
    connect_mqtt()
    publish_sensor_data()
