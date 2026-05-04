# =============================================================
# db.py — Supabase / PostgreSQL Connection
# =============================================================
# This file handles the database connection using psycopg3.
# It exposes one function — get_db() — that all route files
# use to run queries.
#
# We use psycopg3 (not psycopg2) because it is compatible
# with Python 3.14+. The connection string comes from the
# environment variable DATABASE_URL, which Supabase provides.
# =============================================================

import os
import psycopg
from contextlib import contextmanager

# -------------------------------------------------------------
# get_db() — context manager for database connections
# -------------------------------------------------------------
# Usage in a route:
#
#   from db import get_db
#
#   with get_db() as conn:
#       result = conn.execute("SELECT * FROM orders").fetchall()
#
# The 'with' block automatically closes the connection when done,
# even if an error occurs. This prevents connection leaks.
# -------------------------------------------------------------
@contextmanager
def get_db():
    # DATABASE_URL is set in your .env file locally, and in the
    # Render dashboard in production. It looks like:
    # postgresql://user:password@host:port/dbname
    conn_string = os.environ.get("DATABASE_URL")

    if not conn_string:
        raise EnvironmentError(
            "DATABASE_URL is not set. "
            "Add it to your .env file or Render environment variables."
        )

    # row_factory=psycopg.rows.dict_row makes each row come back as
    # a Python dictionary ({"id": 1, "name": "..."}) instead of a
    # plain tuple. Much easier to work with in routes and templates.
    conn = psycopg.connect(
        conn_string,
        row_factory=psycopg.rows.dict_row
    )

    try:
        yield conn          # Hand the connection to the calling code
        conn.commit()       # Save changes if no error occurred
    except Exception:
        conn.rollback()     # Undo changes if something went wrong
        raise               # Re-raise the error so Flask can handle it
    finally:
        conn.close()        # Always close the connection when done
