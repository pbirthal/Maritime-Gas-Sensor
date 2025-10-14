# database.py

from models import Ship, Tank, MasterSensor, MasterTankType, AssignedSensor, SensorLogEntry
import datetime

# --- MASTER TANK TYPE INVENTORY ---
MASTER_TANK_TYPES_DB = {
    "CARGO_LIQUID": MasterTankType(id="CARGO_LIQUID", name="Cargo Hold - Liquid Bulk", required_permits=["Confined Space Entry"]),
    "BALLAST": MasterTankType(id="BALLAST", name="Ballast Tank"),
    "FRESH_WATER": MasterTankType(id="FRESH_WATER", name="Fresh Water Tank"),
    "HFO": MasterTankType(id="HFO", name="Heavy Fuel Oil (HFO) Tank", required_permits=["Hot Work"]),
}

# --- MASTER SENSOR INVENTORY ("The Warehouse") ---
MASTER_SENSORS_DB = {
    "SN-G-001": MasterSensor(id="SN-G-001", type="Multi-gas", battery=98, logs=[
        SensorLogEntry(event="Commissioned", details="Device added to inventory."),
        SensorLogEntry(event="Calibrated", details="Passed quarterly calibration by Officer Smith."),
    ]),
    "SN-G-002": MasterSensor(id="SN-G-002", type="Multi-gas", battery=95, status="In Use", last_used_on_ship="KRISHNA", logs=[
        SensorLogEntry(event="Calibrated", details="Passed calibration."),
        SensorLogEntry(event="Deployed", details="Assigned to INS Krishna / Forepeak Ballast."),
    ]),
    "SN-G-003": MasterSensor(id="SN-G-003", type="Multi-gas", status="Maintenance", battery=55, logs=[
        SensorLogEntry(event="Maintenance", details="Device sent for battery replacement."),
    ]),
    "CO-L-23B": MasterSensor(id="CO-L-23B", type="CO", battery=100),
    "O2-A-119": MasterSensor(id="O2-A-119", type="O2", battery=89, last_calibrated=datetime.date(2025, 8, 1)),
}


# --- SHIP DATABASE ---
SHIPS_DB = {
    "MANTA": Ship(
        id="MANTA", name="MT Great Manta", lastPort="Panama", status="WIP", personnel=12, arrived="10:00 HRS",
        tanks=[
            Tank(id="Cargo Tank 1", type_id="CARGO_LIQUID", sensors=[AssignedSensor(id="SN-G-001")]),
            Tank(id="HFO Tank Portside", type_id="HFO"),
        ]
    ),
    "KRISHNA": Ship(id="KRISHNA", name="INS Krishna", lastPort="Vizag", status="Idle", personnel=8, arrived="08:40 HRS",
        tanks=[
            Tank(id="Forepeak Ballast", type_id="BALLAST", sensors=[AssignedSensor(id="SN-G-002")]),
        ]
    ),
    "SINDHU": Ship(
        id="SINDHU", name="INS Sindhu", lastPort="Cochin", status="Danger", previousStatus="WIP", personnel=14, arrived="07:55 HRS"
    )
}
