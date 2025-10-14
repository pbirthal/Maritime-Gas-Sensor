# sensor_simulator.py

import paho.mqtt.client as mqtt
import serial
import json
import time

# === MQTT Configuration ===
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
SHIP_ID = "MTGREATMANTA"
TOPIC = f"ship/{SHIP_ID}/sensors"

# === Serial Configuration ===
SERIAL_PORT = "/dev/ttyUSB0"  # Change this to your actual port (e.g., COM3 on Windows)
BAUD_RATE = 9600              # Match your sensor’s baud rate

# Initialize MQTT client
client = mqtt.Client()

def connect_mqtt():
    """Connect to the MQTT broker."""
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()
    print(f"Connected to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}")

def read_serial_data():
    """Read and parse sensor data from the serial port."""
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"Reading from serial port {SERIAL_PORT} at {BAUD_RATE} baud.")
        return ser
    except serial.SerialException as e:
        print(f"Error opening serial port: {e}")
        exit(1)

def publish_sensor_data(ser):
    """Continuously read from serial and publish to MQTT."""
    while True:
        line = ser.readline().decode('utf-8').strip()
        if not line:
            continue

        try:
            values = [int(v) for v in line.split()]
            if len(values) < 3:
                print(f"Ignoring invalid line: {line}")
                continue

            o2, co, lel = values[:3]  # Take first 3 readings

            # Create a JSON payload
            reading = {
                "O2": o2,
                "CO": co,
                "LEL": lel
            }

            payload = json.dumps(reading)
            result = client.publish(TOPIC, payload)

            if result[0] == 0:
                print(f"✅ Sent `{payload}` to topic `{TOPIC}`")
            else:
                print(f"⚠️ Failed to send message to topic {TOPIC}")

        except ValueError:
            print(f"Invalid data format: {line}")

        time.sleep(1)  # Adjust delay to match sensor rate

if __name__ == "__main__":
    connect_mqtt()
    ser = read_serial_data()
    publish_sensor_data(ser)
