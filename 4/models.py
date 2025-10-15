# models.py

from sqlalchemy import Column, String, Integer, ForeignKey, Date, DateTime, JSON, Float
from sqlalchemy.orm import relationship
from database import Base
from pydantic import BaseModel, Field
from typing import List, Optional
import datetime

# --- SQLAlchemy Table Models (The Database Schema) ---

class Ship(Base):
    __tablename__ = "ships"
    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    lastPort = Column(String)
    personnel = Column(Integer)
    status = Column(String, default="Idle")
    arrived = Column(String)
    previousStatus = Column(String, nullable=True)
    image = Column(String, nullable=True)
    live_o2 = Column(Float, nullable=True)
    live_co = Column(Float, nullable=True)
    live_lel = Column(Float, nullable=True)
    live_h2s = Column(Float, nullable=True)
    tanks = relationship("Tank", back_populates="owner_ship", cascade="all, delete-orphan")

class Tank(Base):
    __tablename__ = "tanks"
    id = Column(Integer, primary_key=True, index=True)
    ship_specific_id = Column(String, nullable=True)
    type_id = Column(String, ForeignKey("master_tank_types.id"))
    ship_id = Column(String, ForeignKey("ships.id"))
    owner_ship = relationship("Ship", back_populates="tanks")
    sensors = relationship("AssignedSensor", back_populates="owner_tank", cascade="all, delete-orphan")

class AssignedSensor(Base):
    __tablename__ = "assigned_sensors"
    id = Column(Integer, primary_key=True, index=True)
    sensor_id = Column(String, ForeignKey("master_sensors.id"))
    tank_id = Column(Integer, ForeignKey("tanks.id"))
    owner_tank = relationship("Tank", back_populates="sensors")

class MasterSensor(Base):
    __tablename__ = "master_sensors"
    id = Column(String, primary_key=True, index=True)
    type = Column(String)
    status = Column(String, default="Available")
    battery = Column(Integer, default=100)
    last_calibrated = Column(Date, default=datetime.date.today)
    last_used_on_ship = Column(String, nullable=True)
    logs = relationship("SensorLogEntry", back_populates="owner_sensor", cascade="all, delete-orphan")

class SensorLogEntry(Base):
    __tablename__ = "sensor_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.now)
    event = Column(String)
    details = Column(String)
    sensor_id = Column(String, ForeignKey("master_sensors.id"))
    owner_sensor = relationship("MasterSensor", back_populates="logs")

class MasterTankType(Base):
    __tablename__ = "master_tank_types"
    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    required_permits = Column(JSON, default=[])

# --- NEW: Per-tank thresholds (nullable means "use defaults") ---
class TankThreshold(Base):
    __tablename__ = "tank_thresholds"
    id = Column(Integer, primary_key=True, index=True)
    tank_id = Column(Integer, ForeignKey("tanks.id"), unique=True, nullable=False)

    warn_o2_low   = Column(Float, nullable=True)
    danger_o2_low = Column(Float, nullable=True)
    warn_co_high  = Column(Float, nullable=True)
    danger_co_high = Column(Float, nullable=True)
    warn_lel_high = Column(Float, nullable=True)
    danger_lel_high = Column(Float, nullable=True)
    warn_h2s_high = Column(Float, nullable=True)
    danger_h2s_high = Column(Float, nullable=True)

    # relationship if you want backref (optional)
    tank = relationship("Tank", backref="threshold")

# --- NEW: Simple reading archive (for plotting/download later) ---
class ReadingArchive(Base):
    __tablename__ = "reading_archive"
    id = Column(Integer, primary_key=True, index=True)
    ship_id = Column(String, index=True, nullable=False)
    tank_id = Column(Integer, nullable=True)  # optional: wire to a specific tank later
    timestamp = Column(DateTime, default=datetime.datetime.now, nullable=False)
    o2 = Column(Float, nullable=True)
    co = Column(Float, nullable=True)
    lel = Column(Float, nullable=True)
    h2s = Column(Float, nullable=True)

# --- Pydantic Schemas (For API Validation) ---

class SensorLogEntrySchema(BaseModel):
    timestamp: datetime.datetime
    event: str
    details: str
    class Config: from_attributes = True

class MasterSensorCreate(BaseModel): 
    id:str
    type:str
    status:str
    battery:int =100
    last_calibrated:Optional[datetime.date] = None
    last_used_on_ship:Optional[str] = None

class MasterSensorUpdate(BaseModel):
    type: Optional[str] = None
    status: Optional[str] = None   # allow "Available" | "Maintenance"
    battery: Optional[int] = None
    last_calibrated: Optional[datetime.date] = None
    last_used_on_ship: Optional[str] = None

class MasterSensorSchema(BaseModel):
    id: str
    type: str
    status: str
    battery: int
    last_calibrated: datetime.date
    last_used_on_ship: Optional[str] = None
    logs: List[SensorLogEntrySchema] = []
    class Config: from_attributes = True

class AssignedSensorSchema(BaseModel):
    sensor_id: str
    class Config: from_attributes = True

class MasterTankTypeSchema(BaseModel):
    id: str
    name: str
    required_permits: List[str] = []
    class Config: from_attributes = True

class TankSchema(BaseModel):
    id: int
    ship_specific_id: str
    type_id: str
    sensors: List[AssignedSensorSchema] = []
    class Config: from_attributes = True

class ShipSchema(BaseModel):
    id: str
    name: str
    lastPort: str
    personnel: int
    status: str
    arrived: str
    previousStatus: Optional[str] = None
    image: Optional[str] = None
    tanks: List[TankSchema] = []
    live_o2: Optional[float] = None
    live_co: Optional[float] = None
    live_lel: Optional[float] = None
    live_h2s: Optional[float] = None
    class Config: from_attributes = True

# Schemas for creating/updating data
class ShipCreate(BaseModel):
    #id: str
    name: str
    lastPort: str
    personnel: int
    status: str = "Idle"

class ShipUpdate(BaseModel):
    name: Optional[str] = None
    lastPort: Optional[str] = None
    personnel: Optional[int] = None
    status: Optional[str] = None

class TankCreate(BaseModel):
    ship_specific_id:Optional[str]
    type_id: Optional[str]

class SensorAssignRequest(BaseModel):
    sensor_ids: List[str]

class TankThresholdSchema(BaseModel):
    warn_o2_low: Optional[float] = 19.5
    danger_o2_low: Optional[float] = 18.0
    warn_co_high: Optional[float] = 35.0
    danger_co_high: Optional[float] = 100.0
    warn_lel_high: Optional[float] = 5.0
    danger_lel_high: Optional[float] = 10.0
    warn_h2s_high: Optional[float] = 10.0
    danger_h2s_high: Optional[float] = 15.0
    class Config:
        from_attributes = True
