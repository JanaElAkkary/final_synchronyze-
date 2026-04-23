import psycopg2
from psycopg2 import sql

def check_postgres(password):
    try:
        # Try connecting to default 'postgres' database
        conn = psycopg2.connect(
            dbname="postgres",
            user="postgres",
            password=password,
            host="localhost",
            port="5432"
        )
        conn.autocommit = True
        cur = conn.cursor()
        print(f"Successfully connected with password: {password}")
        
        # List databases
        cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false;")
        dbs = cur.fetchall()
        print("Available databases:", [db[0] for db in dbs])
        
        cur.close()
        conn.close()
        return True
    except Exception as e:
        print(f"Connection failed with password '{password}': {e}")
        return False

if __name__ == "__main__":
    if not check_postgres("postgres"):
        check_postgres("") # Try empty password
