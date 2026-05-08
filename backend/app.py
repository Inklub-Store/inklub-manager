# =============================================================
# app.py — Inklub Flask Application Entry Point
# =============================================================
# Updated: Added webhook blueprint for Trello integration.
# Removed orders and customers blueprints (handled by Trello).
# =============================================================

import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

from routes.dashboard  import dashboard_bp
from routes.inventory  import inventory_bp
from routes.settings   import settings_bp
from routes.auth       import auth_bp
from routes.webhook    import webhook_bp   # NEW — Trello webhook


def create_app():
    app = Flask(__name__)

    app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

    # Session cookie settings — required for cross-origin requests
    # between GitHub Pages (frontend) and Render (backend)
    app.config['SESSION_COOKIE_SAMESITE'] = 'None'
    app.config['SESSION_COOKIE_SECURE']   = True
    app.config['SESSION_COOKIE_HTTPONLY'] = True

    # Allow cross-origin requests from GitHub Pages with credentials
    CORS(app,
         origins=os.environ.get("ALLOWED_ORIGIN", "*"),
         supports_credentials=True)

    # Register blueprints
    app.register_blueprint(auth_bp,       url_prefix="/auth")
    app.register_blueprint(dashboard_bp,  url_prefix="/api/dashboard")
    app.register_blueprint(inventory_bp,  url_prefix="/api/inventory")
    app.register_blueprint(settings_bp,   url_prefix="/api/settings")
    app.register_blueprint(webhook_bp,    url_prefix="/webhook")  # NEW

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)