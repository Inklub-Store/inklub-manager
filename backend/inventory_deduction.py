# =============================================================
# inventory_deduction.py — Inklub Store Manager
# Inventory Deduction Logic
# =============================================================
# Handles parsing the [INV: ...] tag from Trello card descriptions
# and deducting the correct quantities from inventory.
#
# HOW THE TAG WORKS:
# She adds this line anywhere in the Trello card description:
#
#   [INV: camiseta-blanca x1, vinilo-negro x35in]
#
# Rules:
#   - Item names are slugified (lowercase, hyphens instead of spaces)
#   - Whole units use just a number: x1, x2
#   - Vinyl inches use the 'in' suffix: x35in, x12.5in
#   - Multiple items separated by commas
#   - The tag can appear anywhere in the description
#
# FIFO FOR VINYL ROLLS:
# If she has multiple rolls of the same color, the deduction
# always comes from the roll with the LEAST remaining inches first
# (i.e. finish the most-used roll before opening a new one).
# =============================================================

import re
import logging
from db import get_db

logger = logging.getLogger(__name__)


# -------------------------------------------------------------
# parse_inv_tag(description)
# -------------------------------------------------------------
# Extracts and parses the [INV: ...] tag from a card description.
#
# Returns a list of dicts like:
# [
#   { 'slug': 'camiseta-blanca', 'quantity': 1,    'unit': 'units'  },
#   { 'slug': 'vinilo-negro',    'quantity': 35.0,  'unit': 'inches' },
# ]
#
# Returns an empty list if no tag is found.
# -------------------------------------------------------------
def parse_inv_tag(description):
    if not description:
        return []

    # Look for [INV: ...] anywhere in the description
    # re.IGNORECASE so [inv: ...] works too
    match = re.search(r'\[INV:\s*([^\]]+)\]', description, re.IGNORECASE)

    if not match:
        return []

    items_str = match.group(1)  # Everything inside the brackets after "INV:"
    items     = []

    # Split by comma to get individual item entries like "camiseta-blanca x1"
    for entry in items_str.split(','):
        entry = entry.strip()
        if not entry:
            continue

        # Match patterns like:
        #   camiseta-blanca x1        → units
        #   vinilo-negro x35in        → inches
        #   vinilo-rojo x12.5in       → inches (decimal)
        unit_match = re.match(
            r'^([\w\-]+)\s+x([\d\.]+)(in)?$',
            entry,
            re.IGNORECASE
        )

        if not unit_match:
            logger.warning(f'Could not parse INV entry: "{entry}" — skipping')
            continue

        slug     = unit_match.group(1).lower().strip()
        quantity = float(unit_match.group(2))
        is_inches = bool(unit_match.group(3))  # True if 'in' suffix present

        items.append({
            'slug':     slug,
            'quantity': quantity,
            'unit':     'inches' if is_inches else 'units'
        })

    return items


# -------------------------------------------------------------
# slugify(name)
# -------------------------------------------------------------
# Converts an inventory item name to a slug for matching.
# e.g. "Camiseta Blanca" → "camiseta-blanca"
#      "Vinilo — Negro"  → "vinilo-negro"
# -------------------------------------------------------------
def slugify(name):
    # Lowercase, replace non-alphanumeric chars with hyphens,
    # collapse multiple hyphens, strip leading/trailing hyphens
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    slug = slug.strip('-')
    return slug


# -------------------------------------------------------------
# find_inventory_item(conn, slug, market_id, unit_type)
# -------------------------------------------------------------
# Finds the inventory item that best matches the given slug.
#
# For vinyl rolls (unit='inches'), uses FIFO — returns the roll
# with the LEAST remaining inches (most used) so we finish
# partial rolls before opening new ones.
#
# For regular items (unit='units'), returns the single item
# matching the slug in the given market.
# -------------------------------------------------------------
def find_inventory_item(conn, slug, market_id, unit_type):
    # Get all inventory items for this market with their slugified names
    items = conn.execute("""
        SELECT i.id, i.name, i.quantity, i.remaining_inches, i.total_inches,
               i.threshold, c.tracking_type, c.unit
        FROM inventory i
        JOIN categories c ON c.id = i.category_id
        WHERE i.market_id = %s
    """, (market_id,)).fetchall()

    # Find items whose slugified name contains the search slug
    # We use 'contains' rather than exact match to be forgiving
    # e.g. slug "vinilo-negro" matches item name "Vinilo — Negro Rollo 1"
    matches = [
        item for item in items
        if slug in slugify(item['name'])
        or slugify(item['name']) in slug
    ]

    if not matches:
        return None

    if unit_type == 'inches':
        # FIFO for vinyl rolls — pick the roll with least remaining inches
        # Filter to only roll-type items
        roll_matches = [m for m in matches if m['tracking_type'] == 'roll']
        if not roll_matches:
            return None
        # Sort by remaining_inches ascending — use most depleted roll first
        roll_matches.sort(key=lambda x: (x['remaining_inches'] or 0))
        return roll_matches[0]
    else:
        # For regular items, return the first match
        return matches[0]


# -------------------------------------------------------------
# process_deductions(market_id, card_id, card_name, description,
#                    webhook_event_id)
# -------------------------------------------------------------
# Main entry point — called when a card moves to Entregados.
# Parses the INV tag, finds each item, and deducts quantities.
#
# Returns a summary dict with what was deducted and any errors.
# -------------------------------------------------------------
def process_deductions(market_id, card_id, card_name, description, webhook_event_id=None):
    items_to_deduct = parse_inv_tag(description)

    if not items_to_deduct:
        logger.info(f'Card "{card_name}" has no [INV:] tag — no deductions made.')
        return {
            'deducted': [],
            'errors':   [],
            'message':  'No [INV:] tag found in card description.'
        }

    deducted = []
    errors   = []

    with get_db() as conn:
        for item_data in items_to_deduct:
            slug     = item_data['slug']
            quantity = item_data['quantity']
            unit     = item_data['unit']

            # Find the matching inventory item
            inv_item = find_inventory_item(conn, slug, market_id, unit)

            if not inv_item:
                error_msg = f'No inventory item found matching "{slug}" in market {market_id}'
                logger.warning(error_msg)
                errors.append(error_msg)
                continue

            # Check if there's enough stock
            if unit == 'inches':
                current = inv_item['remaining_inches'] or 0
                if current < quantity:
                    error_msg = (
                        f'Not enough inches on "{inv_item["name"]}" — '
                        f'need {quantity}in, have {current}in'
                    )
                    logger.warning(error_msg)
                    errors.append(error_msg)
                    # Still deduct what's available rather than blocking the whole order
                    quantity = current

                # Deduct from remaining_inches
                new_remaining = max(0, current - quantity)
                conn.execute("""
                    UPDATE inventory
                    SET remaining_inches = %s,
                        -- Also update the display quantity so the UI stays consistent
                        -- quantity shows remaining as a percentage of total for vinyl
                        quantity = ROUND((%s::numeric / NULLIF(total_inches, 0)) * 100)
                    WHERE id = %s
                """, (new_remaining, new_remaining, inv_item['id']))

            else:
                current = inv_item['quantity'] or 0
                if current < quantity:
                    error_msg = (
                        f'Not enough stock of "{inv_item["name"]}" — '
                        f'need {int(quantity)}, have {int(current)}'
                    )
                    logger.warning(error_msg)
                    errors.append(error_msg)
                    quantity = current

                # Deduct from quantity
                new_quantity = max(0, int(current - quantity))
                conn.execute("""
                    UPDATE inventory SET quantity = %s WHERE id = %s
                """, (new_quantity, inv_item['id']))

            # Log the deduction in inventory_deductions table
            conn.execute("""
                INSERT INTO inventory_deductions (
                    inventory_id, webhook_event_id, card_id, card_name,
                    deducted_units, unit_label, notes
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                inv_item['id'],
                webhook_event_id,
                card_id,
                card_name,
                quantity,
                unit,
                f'Auto-deducted when card moved to Entregados'
            ))

            # Check if this item is now below its threshold
            # and trigger a notification if so
            check_threshold_and_notify(conn, inv_item['id'], market_id)

            deducted.append({
                'item':     inv_item['name'],
                'quantity': quantity,
                'unit':     unit
            })

            logger.info(
                f'Deducted {quantity} {unit} from "{inv_item["name"]}" '
                f'(card: {card_name})'
            )

    return {
        'deducted': deducted,
        'errors':   errors,
        'message':  f'Processed {len(deducted)} deduction(s), {len(errors)} error(s).'
    }


# -------------------------------------------------------------
# check_threshold_and_notify(conn, inventory_id, market_id)
# -------------------------------------------------------------
# Checks if an item is now below its threshold after a deduction
# and sends a low-stock email if so.
# Imports notifications lazily to avoid circular imports.
# -------------------------------------------------------------
def check_threshold_and_notify(conn, inventory_id, market_id):
    item = conn.execute("""
        SELECT i.*, c.unit, c.tracking_type
        FROM inventory i
        JOIN categories c ON c.id = i.category_id
        WHERE i.id = %s
    """, (inventory_id,)).fetchone()

    if not item:
        return

    # For roll items, check remaining_inches against threshold
    # For regular items, check quantity against threshold
    current = item['remaining_inches'] if item['tracking_type'] == 'roll' else item['quantity']

    if current is not None and current <= item['threshold']:
        # Get the notification email from settings
        setting = conn.execute(
            "SELECT value FROM settings WHERE key = 'notification_email'"
        ).fetchone()

        if setting:
            from notifications import send_low_stock_alert
            send_low_stock_alert(
                to_email=setting['value'],
                item_name=item['name'],
                quantity=current,
                unit=item['unit'] if item['tracking_type'] != 'roll' else 'inches',
                market_id=market_id,
                threshold=item['threshold']
            )
