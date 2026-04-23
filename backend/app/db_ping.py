import psycopg2

from backend.app.config import DATABASE_URL


def normalize_url(url):
    if url.startswith("postgresql+psycopg2://"):
        return "postgresql://" + url[len("postgresql+psycopg2://") :]
    return url


def ping_database():
    dsn = normalize_url(DATABASE_URL)
    conn = None
    cursor = None

    try:
        conn = psycopg2.connect(dsn)
        cursor = conn.cursor()
        cursor.execute("SELECT 1;")
        cursor.fetchone()
        print("PASS: DB connected")
    except Exception as exc:
        print("ERROR: DB connection failed:", str(exc))
        raise
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    ping_database()

