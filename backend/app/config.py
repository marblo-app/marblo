from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = ""
    redis_url: str = "redis://redis:6379/0"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    skills_dir: str = "skills"
    backend_port: int = 8001
    backend_host: str = "0.0.0.0"

    model_config = {"env_prefix": "MARBLO_", "env_file": ".env"}


settings = Settings()
