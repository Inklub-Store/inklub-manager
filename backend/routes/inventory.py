# =============================================================
# routes/inventory.py — Inventory Management Routes
# =============================================================
# Handles all inventory operations:
#   - Listing items (with optional category filter)
#   - Adding new items
#   - Updating quantities
#   - Managing categories (add / delete)
#   - Triggering low-stock notifications
# =============================================================

from flask import Blueprint, jsonify, request
from db import get_db
from routes.auth import require_auth
from notifications import send_low_stock_alert

inventory_bp = Blueprint("inventory", __name__)


# -------------------------------------------------------------
# GET /api/inventory/<market_id>
# -------------------------------------------------------------
# Returns all inventory items for a market.
# Optional query param: ?category_id=3 to filter by category.
#
# Example: GET /api/inventory/ca?category_id=2
# -------------------------------------------------------------
@inventory_bp.route("/<market_id>", methods=["GET"])
@require_auth
def get_inventory(market_id):
    category_id = request.args.get("category_id")   # Optional filter

    with get_db() as conn:
        if category_id:
            # Filter by category if provided
            items = conn.execute("""
                SELECT i.*, c.label AS category_label, c.unit
                FROM inventory i
                JOIN categories c ON c.id = i.category_id
                WHERE i.market_id = %s AND i.category_id = %s
                ORDER BY c.label, i.name
            """, (market_id, category_id)).fetchall()
        else:
            # Return all items if no filter
            items = conn.execute("""
                SELECT i.*, c.label AS category_label, c.unit
                FROM inventory i
                JOIN categories c ON c.id = i.category_id
                WHERE i.market_id = %s
                ORDER BY c.label, i.name
            """, (market_id,)).fetchall()

    return jsonify(items), 200


# -------------------------------------------------------------
# POST /api/inventory
# -------------------------------------------------------------
# Adds a new inventory item.
#
# Expected JSON body:
# {
#   "market_id":   "ca",
#   "category_id": 1,
#   "name":        "Vinyl — gold",
#   "quantity":    10,
#   "threshold":   3      // optional, defaults to 5
# }
# -------------------------------------------------------------
@inventory_bp.route("", methods=["POST"])
@require_auth
def add_item():
    data = request.get_json()

    required = ["market_id", "category_id", "name", "quantity"]
    missing = [f for f in required if data.get(f) is None]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    with get_db() as conn:
        item = conn.execute("""
            INSERT INTO inventory (market_id, category_id, name, quantity, threshold)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
        """, (
            data["market_id"],
            data["category_id"],
            data["name"],
            data["quantity"],
            data.get("threshold", 5)   # Default threshold is 5 if not specified
        )).fetchone()

    return jsonify({"message": "Item added.", "item": item}), 201


# -------------------------------------------------------------
# PATCH /api/inventory/<id>/quantity
# -------------------------------------------------------------
# Updates the quantity of an inventory item.
# After updating, checks if the item is now low on stock
# and triggers an email notification if so.
#
# Expected JSON body:
# {
#   "quantity": 2
# }
# -------------------------------------------------------------
@inventory_bp.route("/<int:item_id>/quantity", methods=["PATCH"])
@require_auth
def update_quantity(item_id):
    data = request.get_json()

    if "quantity" not in data or data["quantity"] < 0:
        return jsonify({"error": "A valid quantity (0 or more) is required."}), 400

    with get_db() as conn:
        item = conn.execute("""
            UPDATE inventory SET quantity = %s
            WHERE id = %s
            RETURNING *, (SELECT label FROM categories WHERE id = category_id) AS category_label,
                         (SELECT unit  FROM categories WHERE id = category_id) AS unit
        """, (data["quantity"], item_id)).fetchone()

        if not item:
            return jsonify({"error": "Item not found."}), 404

        # Check if this item is now at or below its threshold
        if item["quantity"] <= item["threshold"]:
            # Fetch the notification email from settings
            setting = conn.execute(
                "SELECT value FROM settings WHERE key = 'notification_email'"
            ).fetchone()

            if setting:
                # Send the low-stock alert email (non-blocking — errors are logged, not raised)
                send_low_stock_alert(
                    to_email=setting["value"],
                    item_name=item["name"],
                    quantity=item["quantity"],
                    unit=item["unit"],
                    market_id=item["market_id"],
                    threshold=item["threshold"]
                )

    return jsonify({"message": "Quantity updated.", "item": item}), 200


# -------------------------------------------------------------
# PATCH /api/inventory/<id>/threshold
# -------------------------------------------------------------
# Updates the low-stock threshold for an item.
# She sets this herself per item from the UI.
#
# Expected JSON body:
# {
#   "threshold": 3
# }
# -------------------------------------------------------------
@inventory_bp.route("/<int:item_id>/threshold", methods=["PATCH"])
@require_auth
def update_threshold(item_id):
    data = request.get_json()

    if "threshold" not in data or data["threshold"] < 0:
        return jsonify({"error": "A valid threshold (0 or more) is required."}), 400

    with get_db() as conn:
        item = conn.execute("""
            UPDATE inventory SET threshold = %s
            WHERE id = %s RETURNING *
        """, (data["threshold"], item_id)).fetchone()

        if not item:
            return jsonify({"error": "Item not found."}), 404

    return jsonify({"message": "Threshold updated.", "item": item}), 200


# -------------------------------------------------------------
# DELETE /api/inventory/<id>
# -------------------------------------------------------------
# Deletes an inventory item permanently.
# -------------------------------------------------------------
@inventory_bp.route("/<int:item_id>", methods=["DELETE"])
@require_auth
def delete_item(item_id):
    with get_db() as conn:
        deleted = conn.execute(
            "DELETE FROM inventory WHERE id = %s RETURNING id", (item_id,)
        ).fetchone()

        if not deleted:
            return jsonify({"error": "Item not found."}), 404

    return jsonify({"message": "Item deleted."}), 200


# =============================================================
# Category management
# =============================================================

# -------------------------------------------------------------
# GET /api/inventory/categories
# -------------------------------------------------------------
# Returns all categories. Used to populate the filter chips
# and the "Add item" form dropdown.
# -------------------------------------------------------------
@inventory_bp.route("/categories", methods=["GET"])
@require_auth
def get_categories():
    with get_db() as conn:
        categories = conn.execute(
            "SELECT * FROM categories ORDER BY label"
        ).fetchall()
    return jsonify(categories), 200


# -------------------------------------------------------------
# POST /api/inventory/categories
# -------------------------------------------------------------
# Creates a new category. She does this from the UI — no code needed.
#
# Expected JSON body:
# {
#   "label": "Caps",
#   "unit":  "units"
# }
# -------------------------------------------------------------
@inventory_bp.route("/categories", methods=["POST"])
@require_auth
def add_category():
    data = request.get_json()

    if not data.get("label"):
        return jsonify({"error": "Category label is required."}), 400

    with get_db() as conn:
        # Check for duplicates (case-insensitive)
        existing = conn.execute(
            "SELECT id FROM categories WHERE label ILIKE %s", (data["label"],)
        ).fetchone()

        if existing:
            return jsonify({"error": "A category with this name already exists."}), 409

        category = conn.execute("""
            INSERT INTO categories (label, unit)
            VALUES (%s, %s)
            RETURNING *
        """, (data["label"], data.get("unit", "units"))).fetchone()

    return jsonify({"message": "Category added.", "category": category}), 201


# -------------------------------------------------------------
# DELETE /api/inventory/categories/<id>
# -------------------------------------------------------------
# Deletes a category. Note: if inventory items reference this
# category, the DELETE will fail due to the foreign key constraint.
# The frontend should warn her before deleting a category that
# has items in it.
# -------------------------------------------------------------
@inventory_bp.route("/categories/<int:category_id>", methods=["DELETE"])
@require_auth
def delete_category(category_id):
    with get_db() as conn:
        # Check if any inventory items use this category
        in_use = conn.execute(
            "SELECT COUNT(*) AS total FROM inventory WHERE category_id = %s",
            (category_id,)
        ).fetchone()

        if in_use["total"] > 0:
            return jsonify({
                "error": f"Cannot delete — {in_use['total']} inventory item(s) use this category. "
                         f"Remove or reassign them first."
            }), 409

        deleted = conn.execute(
            "DELETE FROM categories WHERE id = %s RETURNING id", (category_id,)
        ).fetchone()

        if not deleted:
            return jsonify({"error": "Category not found."}), 404

    return jsonify({"message": "Category deleted."}), 200
