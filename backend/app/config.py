import os
from dotenv import load_dotenv

load_dotenv()

APP_NAME = "Synchronyze API"
APP_VERSION = "0.1.0"

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set")

