# sensor_simulator.py

import paho.mqtt.client as mqtt
import time
import json
import random

MQTT_BROKER = "localhost"
MQTT_PORT = 1883
SHIP_ID = "MANTA"  # We will simulate data for the MT Great Manta
TOPIC = f"ship/{SHIP_ID}/sensors"

client = mqtt.Client()

def connect_mqtt():
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()

def publish_sensor_data():
    o2, co, lel = 20.9, 8, 2
    while True:
        # Simulate normal readings with some random walk
        o2 += (random.random() - 0.5) * 0.2
        co += (random.random() - 0.5) * 4
        lel += (random.random() - 0.5) * 0.7

        # Occasionally, simulate a dangerous event
        if random.random() < 0.1: # 10% chance
            print(">>> SIMULATING DANGER EVENT! CO spike!")
            co = 110 # Spike CO to a dangerous level

        reading = {
            "O2": round(max(14, min(21, o2)), 2),
            "CO": round(max(0, co), 2),
            "LEL": round(max(0, lel), 2),
        }
        
        payload = json.dumps(reading)
        result = client.publish(TOPIC, payload)
        status = result[0]
        if status == 0:
            print(f"Sent `{payload}` to topic `{TOPIC}`")
        else:
            print(f"Failed to send message to topic {TOPIC}")
        
        # Reset CO after spike
        if co > 100:
            co = 8

        time.sleep(3) # Send data every 3 seconds

if __name__ == '__main__':
    connect_mqtt()
    publish_sensor_data()