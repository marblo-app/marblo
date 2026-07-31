from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    PROJECT_NAME: str = "Marblo Backend API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = Field(default="development", env="ENVIRONMENT")

    DATABASE_URL: str = Field(..., env="DATABASE_URL")
    SECRET_KEY: str = Field(..., env="SECRET_KEY")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # NOTE: Payment (Toss / NaverPay) credentials used to be read here for the
    # FastAPI payments router. That router and its services were dead code with
    # zero callers, so they were removed along with these settings — the live
    # payment path is Cloud Functions + marblo-web, which hold their own secrets.

    REDIS_URL: str = Field(default="redis://localhost:6379", env="REDIS_URL")

    # BigQuery Configuration
    GOOGLE_CLOUD_PROJECT: str = Field(..., env="GOOGLE_CLOUD_PROJECT")
    BIGQUERY_DATASET_ID: str = Field(default="marblo_data", env="BIGQUERY_DATASET_ID")

    # Cache Configuration
    CACHE_DEFAULT_TTL: int = Field(default=3600, env="CACHE_DEFAULT_TTL")  # 1 hour
    CACHE_BIGQUERY_TTL: int = Field(default=1800, env="CACHE_BIGQUERY_TTL")  # 30 minutes
    CACHE_API_TTL: int = Field(default=300, env="CACHE_API_TTL")  # 5 minutes

    CORS_ORIGINS: List[str] = Field(default=["http://localhost:3001"], env="CORS_ORIGINS")

    # Monitoring and Logging
    SENTRY_DSN: Optional[str] = Field(default=None, env="SENTRY_DSN")
    LOG_LEVEL: str = Field(default="INFO", env="LOG_LEVEL")

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
