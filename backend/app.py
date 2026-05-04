# =============================================================
# app.py — Inklub Flask Application Entry Point
# =============================================================
# CHANGE: Removed session cookie configuration since we now use
# token-based authentication. Tokens are stored in localStorage
# and sent as Authorization headers — no cookies needed.
# This fixes Safari's cross-origin cookie blocking on iPhone and Mac.
# =============================================================

import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

from routes.dashboard  import dashboard_bp
from routes.orders     import orders_bp
from routes.inventory  import inventory_bp
from routes.customers  import customers_bp
from routes.settings   import settings_bp
from routes.public     import public_bp
from routes.auth       import auth_bp


def create_app():
    app = Flask(__name__)

    # Secret key — still needed by Flask internals even without sessions
    app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

    # CORS — allows requests from the GitHub Pages frontend.
    # supports_credentials is no longer needed since we don't use cookies,
    # but we keep it False explicitly to be clear about the intent.
    CORS(app,
         origins=os.environ.get("ALLOWED_ORIGIN", "*"),
         supports_credentials=False)

    app.register_blueprint(auth_bp,       url_prefix="/auth")
    app.register_blueprint(dashboard_bp,  url_prefix="/api/dashboard")
    app.register_blueprint(orders_bp,     url_prefix="/api/orders")
    app.register_blueprint(inventory_bp,  url_prefix="/api/inventory")
    app.register_blueprint(customers_bp,  url_prefix="/api/customers")
    app.register_blueprint(settings_bp,   url_prefix="/api/settings")
    app.register_blueprint(public_bp,     url_prefix="/order")

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)