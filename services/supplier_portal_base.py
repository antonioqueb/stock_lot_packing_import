# -*- coding: utf-8 -*-

import json
import logging

from odoo.http import request

_logger = logging.getLogger(__name__)


class SupplierPortalBaseService:
    """
    Helpers comunes reutilizables por los servicios del portal.
    """

    # =====================================================================
    #  PARAM HELPER — Odoo 19 compatibility
    # =====================================================================

    def get_params(self):
        """
        Retrieve the JSON-RPC params dict in a way that works across
        all Odoo 19 builds.
        """
        try:
            params = request.params
            if params and isinstance(params, dict):
                return params
        except Exception:
            pass

        try:
            body = request.get_json_data() or {}
            params = body.get("params") or {}
            if isinstance(params, dict):
                return params
        except Exception:
            pass

        try:
            raw = request.httprequest.get_data(as_text=True)
            if raw:
                body = json.loads(raw)
                params = body.get("params") or {}
                if isinstance(params, dict):
                    return params
        except Exception:
            pass

        return {}

    # =====================================================================
    #  HELPERS GENERALES
    # =====================================================================

    def validate_token(self, token):
        access = request.env["stock.picking.supplier.access"].sudo().search(
            [("access_token", "=", token)],
            limit=1,
        )
        if not access or access.is_expired:
            return False
        return access

    def get_or_create_proforma(self, access):
        po = access.purchase_id
        if not po:
            return False

        proforma_model = request.env["supplier.proforma.header"].sudo()
        header = proforma_model.search([("purchase_id", "=", po.id)], limit=1)
        if not header:
            header = proforma_model.create({
                "purchase_id": po.id,
                "access_id": access.id,
            })
        elif not header.access_id:
            header.write({"access_id": access.id})
        return header

    def safe_int(self, value, default=0):
        try:
            if value in (None, False, ""):
                return default
            return int(value)
        except Exception:
            return default

    def safe_float(self, value, default=0.0):
        try:
            if value in (None, False, ""):
                return default
            return float(value)
        except Exception:
            return default

    def normalize_id_list(self, values):
        if not values:
            return []
        result = []
        for value in values:
            int_value = self.safe_int(value, 0)
            if int_value:
                result.append(int_value)
        return list(dict.fromkeys(result))

    def belongs_to_proforma(
        self,
        proforma,
        shipment=None,
        packing=None,
        row=None,
        invoice=None,
        container=None,
    ):
        if not proforma:
            return False

        try:
            if shipment is not None:
                return bool(shipment.exists() and shipment.proforma_id.id == proforma.id)

            if packing is not None:
                return bool(
                    packing.exists()
                    and packing.shipment_id
                    and packing.shipment_id.proforma_id.id == proforma.id
                )

            if row is not None:
                return bool(
                    row.exists()
                    and row.packing_id
                    and row.packing_id.shipment_id
                    and row.packing_id.shipment_id.proforma_id.id == proforma.id
                )

            if invoice is not None:
                return bool(
                    invoice.exists()
                    and invoice.shipment_id
                    and invoice.shipment_id.proforma_id.id == proforma.id
                )

            if container is not None:
                return bool(
                    container.exists()
                    and container.shipment_id
                    and container.shipment_id.proforma_id.id == proforma.id
                )
        except Exception:
            return False

        return False

    def get_picking_moves_for_portal(self, picking):
        moves = False
        if hasattr(picking, "move_ids_without_package"):
            moves = picking.move_ids_without_package
        if not moves:
            moves = picking.move_ids
        return moves.filtered(lambda move: move.state != "cancel")

    def build_products_payload(self, picking):
        moves = self.get_picking_moves_for_portal(picking)
        bucket = {}

        for move in moves:
            product = move.product_id
            if not product:
                continue

            product_id = product.id
            if product_id not in bucket:
                unit_type = product.product_tmpl_id.x_unidad_del_producto or "Placa"
                bucket[product_id] = {
                    "id": product_id,
                    "name": product.display_name or product.name,
                    "code": product.default_code or "",
                    "qty_ordered": 0.0,
                    "uom": (move.product_uom and move.product_uom.name) or "",
                    "unit_type": unit_type,
                }

            bucket[product_id]["qty_ordered"] += (move.product_uom_qty or 0.0)

        products = list(bucket.values())
        products.sort(key=lambda item: (item.get("name") or "").lower())
        return products

    def sorted_shipments(self, shipment_records):
        return shipment_records.sorted("sequence")

    def sorted_packings(self, packing_records):
        return packing_records.sorted(lambda rec: (rec.packing_date or "", rec.id))