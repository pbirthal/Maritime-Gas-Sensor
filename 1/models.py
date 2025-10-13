# models.py

from pydantic import BaseModel, Field
from typing import List, Optional
import datetime

# --- Master Inventory Models ---

class MasterTankType(BaseModel):
    id: str  # e.g., "HFO_TANK"
    name: str  # e.g., "Heavy Fuel Oil (HFO) Tank"
    required_permits: List[str] = []

# --- NEW: Model for a single log event ---
class SensorLogEntry(BaseModel):
    timestamp: datetime.datetime = Field(default_factory=datetime.datetime.now)
    event: str  # e.g., "Calibrated", "Deployed", "Maintenance"
    details: str

class MasterSensor(BaseModel):
    id: str  # The globally unique serial number, e.g., "SN-G-001"
    type: str  # e.g., "Multi-gas", "CO"
    status: str = "Available"  # Available, In Use, Maintenance
    battery: int = 100
    last_calibrated: datetime.date = Field(default_factory=datetime.date.today)
    last_used_on_ship: Optional[str] = None
    logs: List[SensorLogEntry] = []

# --- Component Models (What's actually on a ship) ---

class AssignedSensor(BaseModel):
    id: str # This ID must match an ID in the MasterSensor inventory

class Tank(BaseModel):
    id: str  # The ship-specific name, e.g., "Forepeak DB Tank (P)"
    type_id: str  # The ID from the MasterTankType list, e.g., "BALLAST_TANK"
    sensors: List[AssignedSensor] = []

# --- Ship Models ---

class ShipBase(BaseModel):
    name: str
    lastPort: str
    personnel: int

class ShipCreate(ShipBase):
    id: str
    status: str = "Idle"

class Ship(ShipBase):
    id: str
    status: str
    arrived: str
    previousStatus: Optional[str] = None
    image: Optional[str] = None
    tanks: List[Tank] = []

    class Config:
        from_attributes = True

# --- API Request/Response Models ---

class TankCreateRequest(BaseModel):
    id: str
    type_id: str

class SensorAssignRequest(BaseModel):
    sensor_ids: List[str]

