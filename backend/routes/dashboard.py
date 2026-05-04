# =============================================================
# routes/dashboard.py — Dashboard Summary Routes
# =============================================================
# Returns the summary stats shown on the main dashboard:
#   - Open orders count (and how many are unpaid)
#   - Revenue this month
#   - Orders ready to ship
#   - Low-stock item count and list of alerts
#
# All data is filtered by market (ca or pa).
# =============================================================

from flask import Blueprint, jsonify, request
from db import get_db
from routes.auth import require_auth

dashboard_bp = Blueprint("dashboard", __name__)


# -------------------------------------------------------------
# GET /api/dashboard/<market_id>
# -------------------------------------------------------------
# Returns all summary stats for one market.
# <market_id> is either 'ca' or 'pa'.
# -------------------------------------------------------------
@dashboard_bp.route("/<market_id>", methods=["GET"])
@require_auth
def get_dashboard(market_id):
    with get_db() as conn:

        # --- Open orders (not yet delivered) ---
        open_orders = conn.execute("""
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE payment_status = 'unpaid') AS unpaid
            FROM orders
            WHERE market_id = %s
              AND production_status != 'delivered'
        """, (market_id,)).fetchone()

        # --- Revenue this calendar month ---
        # EXTRACT pulls the month and year from created_at.
        # We only count paid orders so unpaid don't inflate the number.
        revenue = conn.execute("""
            SELECT COALESCE(SUM(total_price), 0) AS total
            FROM orders
            WHERE market_id = %s
              AND payment_status = 'paid'
              AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM NOW())
              AND EXTRACT(YEAR  FROM created_at) = EXTRACT(YEAR  FROM NOW())
        """, (market_id,)).fetchone()

        # --- Orders ready to ship (production done, not yet delivered) ---
        ready = conn.execute("""
            SELECT COUNT(*) AS total
            FROM orders
            WHERE market_id = %s
              AND production_status = 'ready'
        """, (market_id,)).fetchone()

        # --- Low stock alerts ---
        # Returns items where quantity is at or below the threshold she set.
        # Also returns items with quantity = 0 (out of stock).
        low_stock = conn.execute("""
            SELECT i.id, i.name, i.quantity, i.threshold,
                   c.label AS category, c.unit
            FROM inventory i
            JOIN categories c ON c.id = i.category_id
            WHERE i.market_id = %s
              AND i.quantity <= i.threshold
            ORDER BY i.quantity ASC
        """, (market_id,)).fetchall()

        # Fetch market info for display (currency, payment method, etc.)
        market = conn.execute("""
            SELECT * FROM markets WHERE id = %s
        """, (market_id,)).fetchone()

    return jsonify({
        "market":      market,
        "open_orders": open_orders["total"],
        "unpaid":      open_orders["unpaid"],
        "revenue":     float(revenue["total"]),
        "ready":       ready["total"],
        "low_stock_count": len(low_stock),
        "low_stock_items": low_stock
    }), 200
