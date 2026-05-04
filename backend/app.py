# =============================================================
# app.py — Inklub Flask Application Entry Point
# =============================================================
# This is the main file that starts the Flask app.
# It registers all the route blueprints and sets up the app
# configuration from environment variables.
#
# To run locally:
#   python app.py
#
# On Render, the start command should be:
#   gunicorn app:app
# =============================================================

import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables from .env file (local dev only).
# On Render, these are set directly in the dashboard.
load_dotenv()

# Import route blueprints — each file in /routes handles one section
from routes.dashboard  import dashboard_bp
from routes.orders     import orders_bp
from routes.inventory  import inventory_bp
from routes.customers  import customers_bp
from routes.settings   import settings_bp
from routes.public     import public_bp     # Public order form — no login required
from routes.auth       import auth_bp

# -------------------------------------------------------------
# App factory
# -------------------------------------------------------------
def create_app():
    app = Flask(__name__)

    # Secret key is used to sign session cookies (login sessions).
    # MUST be set as an environment variable in production — never hardcode it.
    app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

    # Allow cross-origin requests from the GitHub Pages frontend.
    # In production, replace "*" with your actual GitHub Pages URL,
    # e.g. "https://your-org.github.io"
    CORS(app, origins=os.environ.get("ALLOWED_ORIGIN", "*"))

    # Register blueprints — each blueprint is a group of related routes.
    # The url_prefix makes all routes in that blueprint start with that path.
    app.register_blueprint(auth_bp,       url_prefix="/auth")
    app.register_blueprint(dashboard_bp,  url_prefix="/api/dashboard")
    app.register_blueprint(orders_bp,     url_prefix="/api/orders")
    app.register_blueprint(inventory_bp,  url_prefix="/api/inventory")
    app.register_blueprint(customers_bp,  url_prefix="/api/customers")
    app.register_blueprint(settings_bp,   url_prefix="/api/settings")

    # Public routes have no /api prefix — they are meant to be
    # accessed directly by customers filling in the order form
    app.register_blueprint(public_bp,     url_prefix="/order")

    return app


# Create the app instance (Gunicorn imports this directly)
app = create_app()

if __name__ == "__main__":
    # Debug mode is ON locally so Flask auto-reloads on file changes.
    # Never run with debug=True on a production server.
    app.run(debug=True, port=5000)
