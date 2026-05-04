# =============================================================
# routes/dashboard.py — Dashboard Summary Routes
# =============================================================
# Returns all data needed for the Inicio screen:
#   - Stat cards (open orders, revenue, ready, low stock)
#   - Low stock alert items
#   - Unpaid orders list (for payment summary section)
#   - Recent orders (for the preview cards at the bottom)
#   - Total pending collection amount
#
# FIX: Added unpaid_orders, recent_orders, and total_pending
# fields that the frontend dashboard.js expects but were missing
# from the original version of this file.
# =============================================================

from flask import Blueprint, jsonify
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
        # Also counts how many are unpaid so the stat card can show
        # "7 pedidos / 3 sin pagar" in one query instead of two.
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
        # COALESCE returns 0 if there are no paid orders yet this month.
        revenue = conn.execute("""
            SELECT COALESCE(SUM(total_price), 0) AS total
            FROM orders
            WHERE market_id = %s
              AND payment_status = 'paid'
              AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM NOW())
              AND EXTRACT(YEAR  FROM created_at) = EXTRACT(YEAR  FROM NOW())
        """, (market_id,)).fetchone()

        # --- Orders ready to ship ---
        # Production is done but not yet delivered to the customer.
        ready = conn.execute("""
            SELECT COUNT(*) AS total
            FROM orders
            WHERE market_id = %s
              AND production_status = 'ready'
        """, (market_id,)).fetchone()

        # --- Low stock alerts ---
        # Returns items where quantity is at or below the threshold she set.
        # Ordered by quantity ascending so the most urgent items appear first.
        low_stock = conn.execute("""
            SELECT i.id, i.name, i.quantity, i.threshold,
                   c.label AS category, c.unit
            FROM inventory i
            JOIN categories c ON c.id = i.category_id
            WHERE i.market_id = %s
              AND i.quantity <= i.threshold
            ORDER BY i.quantity ASC
        """, (market_id,)).fetchall()

        # --- Unpaid orders (for the payment summary section) ---
        # Shows who owes money so she can see the total pending collection
        # at a glance. Only active (non-delivered) orders are included.
        unpaid_orders = conn.execute("""
            SELECT id, customer_name, product, total_price
            FROM orders
            WHERE market_id = %s
              AND payment_status = 'unpaid'
              AND production_status != 'delivered'
            ORDER BY created_at DESC
        """, (market_id,)).fetchall()

        # --- Total pending collection ---
        # Sum of all unpaid active orders — shown in the "Total por cobrar"
        # row at the bottom of the payment summary block on the dashboard.
        total_pending = conn.execute("""
            SELECT COALESCE(SUM(total_price), 0) AS total
            FROM orders
            WHERE market_id = %s
              AND payment_status = 'unpaid'
              AND production_status != 'delivered'
        """, (market_id,)).fetchone()

        # --- Recent orders (latest 3 active orders for the preview cards) ---
        # Joins markets to include the currency label (e.g. CAD, PAB/USD)
        # so the frontend can display "$60 CAD" without a separate API call.
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
        # Currency, payment method, flag — used for display labels in the UI.
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
        "unpaid_orders":   list(unpaid_orders),           # For payment summary
        "total_pending":   float(total_pending["total"]), # Total por cobrar
        "recent_orders":   list(recent_orders),           # For preview cards
    }), 200