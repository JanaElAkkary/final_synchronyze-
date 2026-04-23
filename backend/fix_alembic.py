from backend.app.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    conn.execute(text("UPDATE alembic_version SET version_num = 'e64f95b72f50'"))
    conn.commit()
    print("Database stamped to e64f95b72f50")
