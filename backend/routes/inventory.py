# =============================================================
# routes/inventory.py — Inventory Management Routes
# =============================================================
# Handles all inventory operations:
#   - Listing items (with optional category filter)
#   - Adding new items (regular units OR vinyl rolls)
#   - Updating quantities / remaining inches
#   - Updating minimum stock thresholds
#   - Managing categories (add / delete)
#   - Triggering low-stock notifications
#
# VINYL ROLL TRACKING:
# Items in categories with tracking_type = 'roll' are measured
# in inches rather than whole units. They have three extra fields:
#   - total_inches     : full length of the roll when new
#   - remaining_inches : how many inches are left
#   - roll_color       : e.g. "Negro", "Rojo", "Blanco"
#
# When a Trello card moves to Entregados, inventory_deduction.py
# calls this module's update logic to deduct the used inches.
# =============================================================

from flask import Blueprint, jsonify, request
from db import get_db
from routes.auth import require_auth
from notifications import send_low_stock_alert

inventory_bp = Blueprint("inventory", __name__)


# -------------------------------------------------------------
# GET /api/inventory/<market_id>
# -------------------------------------------------------------
# Returns all inventory items for a market, joined with their
# category info (label, unit, tracking_type).
# Optional query param: ?category_id=3 to filter by category.
#
# tracking_type is included so the frontend knows whether to
# display the item as units or as remaining/total inches.
# -------------------------------------------------------------
@inventory_bp.route("/<market_id>", methods=["GET"])
@require_auth
def get_inventory(market_id):
    category_id = request.args.get("category_id")

    with get_db() as conn:
        if category_id:
            # Filter by category if the frontend sent one
            items = conn.execute("""
                SELECT i.*, c.label AS category_label, c.unit, c.tracking_type
                FROM inventory i
                JOIN categories c ON c.id = i.category_id
                WHERE i.market_id = %s AND i.category_id = %s
                ORDER BY c.label, i.name
            """, (market_id, category_id)).fetchall()
        else:
            # Return all items for this market
            items = conn.execute("""
                SELECT i.*, c.label AS category_label, c.unit, c.tracking_type
                FROM inventory i
                JOIN categories c ON c.id = i.category_id
                WHERE i.market_id = %s
                ORDER BY c.label, i.name
            """, (market_id,)).fetchall()

    return jsonify(list(items)), 200


# -------------------------------------------------------------
# POST /api/inventory
# -------------------------------------------------------------
# Adds a new inventory item. Behavior differs based on whether
# the category is a regular item or a vinyl roll.
#
# Expected JSON body for a REGULAR item:
# {
#   "market_id":   "ca",
#   "category_id": 1,
#   "name":        "T-shirt Blanca",
#   "quantity":    10,
#   "threshold":   3
# }
#
# Expected JSON body for a VINYL ROLL:
# {
#   "market_id":         "ca",
#   "category_id":       5,
#   "name":              "Vinilo Negro Rollo 1",
#   "roll_color":        "Negro",
#   "total_inches":      120,
#   "remaining_inches":  120,
#   "threshold":         12
# }
#
# For roll items, quantity is stored as a percentage (0-100)
# derived from remaining/total — this is used for the bar
# display in the frontend. The actual remaining inches are
# stored separately in remaining_inches.
# -------------------------------------------------------------
@inventory_bp.route("", methods=["POST"])
@require_auth
def add_item():
    data = request.get_json()

    # Name, market, and category are always required
    required = ["market_id", "category_id", "name"]
    missing = [f for f in required if data.get(f) is None]
    if missing:
        return jsonify({"error": f"Campos requeridos: {', '.join(missing)}"}), 400

    with get_db() as conn:
        # Look up the category to determine tracking type
        category = conn.execute("""
            SELECT tracking_type FROM categories WHERE id = %s
        """, (data["category_id"],)).fetchone()

        if not category:
            return jsonify({"error": "Categoría no encontrada."}), 404

        is_roll = category["tracking_type"] == "roll"

        if is_roll:
            # --- Vinyl roll item ---
            total_inches     = data.get("total_inches", 0)
            remaining_inches = data.get("remaining_inches", total_inches)
            roll_color       = data.get("roll_color", "")

            # quantity stores the fill percentage (0-100) for the progress bar
            # e.g. if 90in remain out of 120in total → quantity = 75
            quantity = round((remaining_inches / total_inches * 100)) if total_inches > 0 else 0

            item = conn.execute("""
                INSERT INTO inventory (
                    market_id, category_id, name, quantity, threshold,
                    total_inches, remaining_inches, roll_color
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                data["market_id"],
                data["category_id"],
                data["name"],
                quantity,
                data.get("threshold", 12),  # Default threshold: 12 inches for vinyl
                total_inches,
                remaining_inches,
                roll_color
            )).fetchone()

        else:
            # --- Regular unit item ---
            item = conn.execute("""
                INSERT INTO inventory (
                    market_id, category_id, name, quantity, threshold
                ) VALUES (%s, %s, %s, %s, %s)
                RETURNING *
            """, (
                data["market_id"],
                data["category_id"],
                data["name"],
                data.get("quantity", 0),
                data.get("threshold", 5)   # Default threshold: 5 units
            )).fetchone()

    return jsonify({"message": "Producto agregado.", "item": dict(item)}), 201


# -------------------------------------------------------------
# PATCH /api/inventory/<id>/quantity
# -------------------------------------------------------------
# Updates stock for an item. Behavior differs by tracking type:
#
# For REGULAR items:
#   Expects: { "quantity": 10 }
#   Updates the quantity column directly.
#
# For VINYL ROLLS:
#   Expects: { "remaining_inches": 85.5 }
#   Updates remaining_inches and recalculates quantity (%).
#
# After updating, checks if the item is now at or below its
# threshold and triggers a low-stock email alert if so.
# -------------------------------------------------------------
@inventory_bp.route("/<int:item_id>/quantity", methods=["PATCH"])
@require_auth
def update_quantity(item_id):
    data = request.get_json()

    with get_db() as conn:
        # Fetch the item with its category info to determine tracking type
        item = conn.execute("""
            SELECT i.*, c.tracking_type, c.unit
            FROM inventory i
            JOIN categories c ON c.id = i.category_id
            WHERE i.id = %s
        """, (item_id,)).fetchone()

        if not item:
            return jsonify({"error": "Producto no encontrado."}), 404

        if item["tracking_type"] == "roll":
            # --- Vinyl roll update ---
            if "remaining_inches" not in data:
                return jsonify({
                    "error": "remaining_inches es requerido para rollos de vinilo."
                }), 400

            remaining = float(data["remaining_inches"])
            total     = item["total_inches"] or 0

            # Recalculate the percentage for the progress bar
            quantity = round((remaining / total * 100)) if total > 0 else 0

            updated = conn.execute("""
                UPDATE inventory
                SET remaining_inches = %s, quantity = %s
                WHERE id = %s
                RETURNING *
            """, (remaining, quantity, item_id)).fetchone()

            # Check if remaining inches dropped below threshold
            if remaining <= item["threshold"]:
                setting = conn.execute(
                    "SELECT value FROM settings WHERE key = 'notification_email'"
                ).fetchone()
                if setting:
                    send_low_stock_alert(
                        to_email=setting["value"],
                        item_name=item["name"],
                        quantity=remaining,
                        unit="pulgadas",
                        market_id=item["market_id"],
                        threshold=item["threshold"]
                    )

        else:
            # --- Regular item update ---
            if "quantity" not in data or data["quantity"] < 0:
                return jsonify({"error": "Cantidad inválida."}), 400

            updated = conn.execute("""
                UPDATE inventory SET quantity = %s WHERE id = %s RETURNING *
            """, (data["quantity"], item_id)).fetchone()

            # Check if quantity dropped below threshold
            if updated["quantity"] <= item["threshold"]:
                setting = conn.execute(
                    "SELECT value FROM settings WHERE key = 'notification_email'"
                ).fetchone()
                if setting:
                    send_low_stock_alert(
                        to_email=setting["value"],
                        item_name=item["name"],
                        quantity=updated["quantity"],
                        unit=item["unit"],
                        market_id=item["market_id"],
                        threshold=item["threshold"]
                    )

    return jsonify({"message": "Stock actualizado.", "item": dict(updated)}), 200


# -------------------------------------------------------------
# PATCH /api/inventory/<id>/threshold
# -------------------------------------------------------------
# Updates the minimum stock threshold for an item.
# For vinyl rolls this value is in inches.
# For regular items this value is in units.
# An alert email is sent when stock drops to or below this number.
# -------------------------------------------------------------
@inventory_bp.route("/<int:item_id>/threshold", methods=["PATCH"])
@require_auth
def update_threshold(item_id):
    data = request.get_json()

    if "threshold" not in data or data["threshold"] < 0:
        return jsonify({"error": "Umbral inválido."}), 400

    with get_db() as conn:
        item = conn.execute("""
            UPDATE inventory SET threshold = %s
            WHERE id = %s RETURNING *
        """, (data["threshold"], item_id)).fetchone()

        if not item:
            return jsonify({"error": "Producto no encontrado."}), 404

    return jsonify({"message": "Mínimo actualizado.", "item": dict(item)}), 200


# -------------------------------------------------------------
# DELETE /api/inventory/<id>
# -------------------------------------------------------------
# Permanently deletes an inventory item.
# The frontend asks for confirmation before calling this.
# -------------------------------------------------------------
@inventory_bp.route("/<int:item_id>", methods=["DELETE"])
@require_auth
def delete_item(item_id):
    with get_db() as conn:
        deleted = conn.execute(
            "DELETE FROM inventory WHERE id = %s RETURNING id", (item_id,)
        ).fetchone()

        if not deleted:
            return jsonify({"error": "Producto no encontrado."}), 404

    return jsonify({"message": "Producto eliminado."}), 200


# =============================================================
# CATEGORY MANAGEMENT
# =============================================================

# -------------------------------------------------------------
# GET /api/inventory/categories
# -------------------------------------------------------------
# Returns all categories including tracking_type so the frontend
# knows whether to show roll or unit fields in the add item form.
# -------------------------------------------------------------
@inventory_bp.route("/categories", methods=["GET"])
@require_auth
def get_categories():
    with get_db() as conn:
        categories = conn.execute(
            "SELECT * FROM categories ORDER BY label"
        ).fetchall()
    return jsonify(list(categories)), 200


# -------------------------------------------------------------
# POST /api/inventory/categories
# -------------------------------------------------------------
# Creates a new category. She does this from the UI — no code needed.
#
# Expected JSON body:
# {
#   "label":         "Gorras",
#   "unit":          "units",
#   "tracking_type": "units"   // or "roll" for vinyl
# }
# -------------------------------------------------------------
@inventory_bp.route("/categories", methods=["POST"])
@require_auth
def add_category():
    data = request.get_json()

    if not data.get("label"):
        return jsonify({"error": "El nombre de la categoría es obligatorio."}), 400

    with get_db() as conn:
        # Check for duplicates (case-insensitive)
        existing = conn.execute(
            "SELECT id FROM categories WHERE label ILIKE %s", (data["label"],)
        ).fetchone()

        if existing:
            return jsonify({"error": "Ya existe una categoría con ese nombre."}), 409

        category = conn.execute("""
            INSERT INTO categories (label, unit, tracking_type)
            VALUES (%s, %s, %s)
            RETURNING *
        """, (
            data["label"],
            data.get("unit", "units"),
            data.get("tracking_type", "units")  # Default to units unless specified
        )).fetchone()

    return jsonify({"message": "Categoría agregada.", "category": dict(category)}), 201


# -------------------------------------------------------------
# DELETE /api/inventory/categories/<id>
# -------------------------------------------------------------
# Deletes a category. Will fail if any inventory items still
# reference this category — the frontend shows a helpful error
# message in that case telling her to remove the items first.
# -------------------------------------------------------------
@inventory_bp.route("/categories/<int:category_id>", methods=["DELETE"])
@require_auth
def delete_category(category_id):
    with get_db() as conn:
        # Check if any items still use this category
        in_use = conn.execute(
            "SELECT COUNT(*) AS total FROM inventory WHERE category_id = %s",
            (category_id,)
        ).fetchone()

        if in_use["total"] > 0:
            return jsonify({
                "error": f"No puedes eliminar — {in_use['total']} producto(s) usan esta categoría. "
                         f"Elimínalos o cámbiales la categoría primero."
            }), 409

        deleted = conn.execute(
            "DELETE FROM categories WHERE id = %s RETURNING id", (category_id,)
        ).fetchone()

        if not deleted:
            return jsonify({"error": "Categoría no encontrada."}), 404

    return jsonify({"message": "Categoría eliminada."}), 200