# main.py

import json
import threading
import paho.mqtt.client as mqtt
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Import everything from our new, structured files
from models import (
    Ship, ShipCreate, ShipBase,
    Tank, TankCreateRequest,
    MasterSensor, AssignedSensor, SensorAssignRequest,
    MasterTankType
)
from database import SHIPS_DB, MASTER_SENSORS_DB, MASTER_TANK_TYPES_DB

# --- FastAPI APP ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# --- MASTER DATA ENDPOINTS ---
@app.get("/api/master/sensors", response_model=list[MasterSensor], tags=["Master Data"])
async def get_master_sensor_list():
    """Get the complete list of all sensors owned by the shipyard."""
    return list(MASTER_SENSORS_DB.values())

@app.get("/api/master/tank-types", response_model=list[MasterTankType], tags=["Master Data"])
async def get_master_tank_types():
    """Get the list of pre-defined, standard tank types."""
    return list(MASTER_TANK_TYPES_DB.values())

@app.get("/api/master/sensors/{sensor_id}", response_model=MasterSensor, tags=["Master Data"])
async def get_master_sensor_details(sensor_id: str):
    """Get the complete details and event log for a single sensor."""
    if sensor_id not in MASTER_SENSORS_DB:
        raise HTTPException(status_code=404, detail="Sensor not found.")
    return MASTER_SENSORS_DB[sensor_id]

# --- SHIP ENDPOINTS ---
@app.get("/api/ships", response_model=list[Ship], tags=["Ships"])
async def get_all_ships():
    return list(SHIPS_DB.values())

# ... (Your existing create, update, delete, and acknowledge ship endpoints go here)

# --- TANK ENDPOINTS ---
@app.post("/api/ships/{ship_id}/tanks", response_model=Tank, tags=["Tanks"])
async def add_tank_to_ship(ship_id: str, tank_data: TankCreateRequest):
    """Adds a single new tank to a ship using a pre-defined type."""
    if ship_id not in SHIPS_DB:
        raise HTTPException(status_code=404, detail="Ship not found.")
    if tank_data.type_id not in MASTER_TANK_TYPES_DB:
        raise HTTPException(status_code=400, detail="Invalid Tank Type ID.")
    
    ship = SHIPS_DB[ship_id]
    
    # Check for duplicate custom ID on the same ship
    if any(tank.id == tank_data.id for tank in ship.tanks):
        raise HTTPException(status_code=400, detail=f"Tank with ID '{tank_data.id}' already exists on this ship.")

    new_tank = Tank(**tank_data.dict())
    ship.tanks.append(new_tank)
    return new_tank

# --- SENSOR ASSIGNMENT ENDPOINTS ---
@app.post("/api/ships/{ship_id}/tanks/{tank_id}/sensors", response_model=list[AssignedSensor], tags=["Sensors"])
async def assign_sensors_to_tank(ship_id: str, tank_id: str, request: SensorAssignRequest):
    """Assigns one or more available sensors to a specific tank."""
    if ship_id not in SHIPS_DB:
        raise HTTPException(status_code=404, detail="Ship not found.")
    
    ship = SHIPS_DB[ship_id]
    target_tank = next((t for t in ship.tanks if t.id == tank_id), None)
    if not target_tank:
        raise HTTPException(status_code=404, detail="Tank not found.")

    # First, validate all requested sensors before making any changes
    for sensor_id in request.sensor_ids:
        if sensor_id not in MASTER_SENSORS_DB:
            raise HTTPException(status_code=400, detail=f"Sensor '{sensor_id}' not found in master inventory.")
        if MASTER_SENSORS_DB[sensor_id].status != "Available":
            raise HTTPException(status_code=400, detail=f"Sensor '{sensor_id}' is not available.")

    # If all are valid, proceed with the assignments
    for sensor_id in request.sensor_ids:
        target_tank.sensors.append(AssignedSensor(id=sensor_id))
        MASTER_SENSORS_DB[sensor_id].status = "In Use"
        MASTER_SENSORS_DB[sensor_id].last_used_on_ship = ship.name

    return target_tank.sensors

@app.delete("/api/ships/{ship_id}/tanks/{tank_id}/sensors/{sensor_id}", status_code=204, tags=["Sensors"])
async def unassign_sensor_from_tank(ship_id: str, tank_id: str, sensor_id: str):
    """Removes a sensor from a tank and makes it 'Available' again."""
    if ship_id not in SHIPS_DB:
        raise HTTPException(status_code=404, detail="Ship not found.")
    
    ship = SHIPS_DB[ship_id]
    target_tank = next((t for t in ship.tanks if t.id == tank_id), None)
    if not target_tank:
        raise HTTPException(status_code=404, detail="Tank not found.")

    # Remove sensor from the tank's list
    original_sensor_count = len(target_tank.sensors)
    target_tank.sensors = [s for s in target_tank.sensors if s.id != sensor_id]
    if len(target_tank.sensors) == original_sensor_count:
        raise HTTPException(status_code=404, detail="Sensor not found in this tank.")

    # Update the master sensor's status back to 'Available'
    if sensor_id in MASTER_SENSORS_DB:
        MASTER_SENSORS_DB[sensor_id].status = "Available"

    return

# --- MQTT Integration (No changes needed here) ---
# ... (The rest of your MQTT code remains the same)