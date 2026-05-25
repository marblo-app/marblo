from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from backend.core.config import settings
import os

# Production-optimized connection pool settings
engine_kwargs = {
    "pool_pre_ping": True,
    "pool_recycle": 3600,  # Recycle connections after 1 hour
    "pool_size": 10,       # Base number of connections
    "max_overflow": 20,    # Maximum overflow connections
    "echo": settings.ENVIRONMENT != "production",  # Only log SQL in non-production
}

# For Cloud SQL, add additional connection arguments
if "/cloudsql/" in settings.DATABASE_URL:
    engine_kwargs.update({
        "connect_args": {
            "connect_timeout": 60,
            "application_name": f"marblo-backend-{settings.ENVIRONMENT}",
        }
    })

engine = create_engine(settings.DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()