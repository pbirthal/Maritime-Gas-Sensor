# database.py
# database.py
from pathlib import Path
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Base dir = folder where database.py lives
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)   # ensure folder exists

# Prefer env var if set, else use backend/data/shipyard.db
DEFAULT_DB_URL = f"sqlite:///{(DATA_DIR / 'shipyard.db').as_posix()}"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DB_URL)

# For SQLite + FastAPI threads:
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# from sqlalchemy import create_engine
# from sqlalchemy.orm import sessionmaker
# from sqlalchemy.ext.declarative import declarative_base

# # --- Database Setup ---
# DATABASE_URL = "sqlite:///./shipyard.db" # This creates a new file named shipyard.db

# engine = create_engine(
#     DATABASE_URL, connect_args={"check_same_thread": False}
# )

# SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base = declarative_base()

# # Function to get a database session
# def get_db():
#     db = SessionLocal()
#     try:
#         yield db
#     finally:
#         db.close()