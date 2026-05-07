# =============================================================
# routes/dashboard.py — Dashboard Summary Routes
# =============================================================
# Updated: Added total_items count for the simplified Inicio screen.
# Since orders are managed in Trello, the dashboard now focuses
# purely on inventory health.
# =============================================================

from flask import Blueprint, jsonify
from db import get_db
from routes.auth import require_auth

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.route("/<market_id>", methods=["GET"])
@require_auth
def get_dashboard(market_id):
    with get_db() as conn:

        # --- Open orders (kept for potential future use) ---
        open_orders = conn.execute("""
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE payment_status = 'unpaid') AS unpaid
            FROM orders
            WHERE market_id = %s
              AND production_status != 'delivered'
        """, (market_id,)).fetchone()

        # --- Revenue this calendar month ---
        revenue = conn.execute("""
            SELECT COALESCE(SUM(total_price), 0) AS total
            FROM orders
            WHERE market_id = %s
              AND payment_status = 'paid'
              AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM NOW())
              AND EXTRACT(YEAR  FROM created_at) = EXTRACT(YEAR  FROM NOW())
        """, (market_id,)).fetchone()

        # --- Orders ready to ship ---
        ready = conn.execute("""
            SELECT COUNT(*) AS total
            FROM orders
            WHERE market_id = %s
              AND production_status = 'ready'
        """, (market_id,)).fetchone()

        # --- Low stock alerts ---
        # Items at or below their threshold, ordered most urgent first
        low_stock = conn.execute("""
            SELECT i.id, i.name, i.quantity, i.threshold,
                   c.label AS category, c.unit
            FROM inventory i
            JOIN categories c ON c.id = i.category_id
            WHERE i.market_id = %s
              AND i.quantity <= i.threshold
            ORDER BY i.quantity ASC
        """, (market_id,)).fetchall()

        # --- Total inventory items for this market ---
        # Used on the simplified Inicio screen stat card
        total_items = conn.execute("""
            SELECT COUNT(*) AS total
            FROM inventory
            WHERE market_id = %s
        """, (market_id,)).fetchone()

        # --- Unpaid orders (for potential future use) ---
        unpaid_orders = conn.execute("""
            SELECT id, customer_name, product, total_price
            FROM orders
            WHERE market_id = %s
              AND payment_status = 'unpaid'
              AND production_status != 'delivered'
            ORDER BY created_at DESC
        """, (market_id,)).fetchall()

        # --- Total pending collection ---
        total_pending = conn.execute("""
            SELECT COALESCE(SUM(total_price), 0) AS total
            FROM orders
            WHERE market_id = %s
              AND payment_status = 'unpaid'
              AND production_status != 'delivered'
        """, (market_id,)).fetchone()

        # --- Recent orders ---
        recent_orders = conn.execute("""
            SELECT o.*, m.currency
            FROM orders o
            JOIN markets m ON m.id = o.market_id
            WHERE o.market_id = %s
              AND o.production_status != 'delivered'
            ORDER BY o.created_at DESC
            LIMIT 3
        """, (market_id,)).fetchall()

        # --- Market info ---
        market = conn.execute("""
            SELECT * FROM markets WHERE id = %s
        """, (market_id,)).fetchone()

    return jsonify({
        "market":          market,
        "open_orders":     open_orders["total"],
        "unpaid":          open_orders["unpaid"],
        "revenue":         float(revenue["total"]),
        "ready":           ready["total"],
        "low_stock_count": len(low_stock),
        "low_stock_items": list(low_stock),
        "total_items":     total_items["total"],   # New — for Inicio stat card
        "unpaid_orders":   list(unpaid_orders),
        "total_pending":   float(total_pending["total"]),
        "recent_orders":   list(recent_orders),
    }), 200