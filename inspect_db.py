import os
import sys

# Set env var if not set
if not os.getenv("DATABASE_URL"):
    os.environ["DATABASE_URL"] = "sqlite:///backend/app/db.sqlite3"

from sqlalchemy import create_engine, inspect
from backend.app.config import DATABASE_URL

print(f"Using DATABASE_URL: {DATABASE_URL}")

try:
    engine = create_engine(DATABASE_URL)
    inspector = inspect(engine)

    if "tasks" in inspector.get_table_names():
        print("Columns in tasks:")
        columns = inspector.get_columns("tasks")
        for col in columns:
            print(f"- {col['name']} ({col['type']})")
    else:
        print("Table 'tasks' does not exist.")
except Exception as e:
    print(f"Error: {e}")
