# -*- coding: utf-8 -*-

import json
import logging

from odoo.http import request

_logger = logging.getLogger(__name__)


class SupplierPortalBaseService:
    """
    Helpers comunes reutilizables por los servicios del portal.
    Compatibles con Odoo 19.
    """

    def get_params(self):
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
            # PRIMERA VEZ: Se precarga la info base de la OC en el Portal
            header = proforma_model.create({
                "purchase_id": po.id,
                "access_id": access.id,
                "proforma_number": po.partner_ref or "",
                "payment_terms": po.payment_term_id.name if po.payment_term_id else "",
                "incoterm": po.incoterm_id.code if po.incoterm_id else "",
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
                return bool(
                    shipment.exists()
                    and shipment.proforma_id
                    and shipment.proforma_id.id == proforma.id
                )

            if packing is not None:
                return bool(
                    packing.exists()
                    and packing.shipment_id
                    and packing.shipment_id.proforma_id
                    and packing.shipment_id.proforma_id.id == proforma.id
                )

            if row is not None:
                return bool(
                    row.exists()
                    and row.packing_id
                    and row.packing_id.shipment_id
                    and row.packing_id.shipment_id.proforma_id
                    and row.packing_id.shipment_id.proforma_id.id == proforma.id
                )

            if invoice is not None:
                return bool(
                    invoice.exists()
                    and invoice.shipment_id
                    and invoice.shipment_id.proforma_id
                    and invoice.shipment_id.proforma_id.id == proforma.id
                )

            if container is not None:
                return bool(
                    container.exists()
                    and container.shipment_id
                    and container.shipment_id.proforma_id
                    and container.shipment_id.proforma_id.id == proforma.id
                )
        except Exception:
            return False

        return False

    def build_products_payload_from_purchase(self, purchase):
        bucket = {}

        for line in purchase.order_line.filtered(lambda l: not l.display_type and l.product_id):
            product = line.product_id
            if product.id not in bucket:
                unit_type = product.product_tmpl_id.x_unidad_del_producto or "Placa"
                bucket[product.id] = {
                    "id": product.id,
                    "name": product.display_name or product.name,
                    "code": product.default_code or "",
                    "qty_ordered": 0.0,
                    "uom": (line.product_uom_id and line.product_uom_id.name) or "",
                    "unit_type": unit_type,
                }

            bucket[product.id]["qty_ordered"] += (line.product_qty or 0.0)

        products = list(bucket.values())
        products.sort(key=lambda item: (item.get("name") or "").lower())
        return products

    def sorted_shipments(self, shipment_records):
        return shipment_records.sorted("sequence")

    def sorted_packings(self, packing_records):
        return packing_records.sorted(lambda rec: (rec.packing_date or "", rec.id))