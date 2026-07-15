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
        # Registra la última conexión del proveedor (throttle interno).
        try:
            access._touch_last_access()
        except Exception:
            pass
        return access

    def is_internal_user(self):
        """True si quien usa el portal es un usuario INTERNO de la empresa con
        sesión activa en Odoo (no el proveedor público). En rutas auth='public',
        request.env.user es el usuario logueado si hay sesión, o el público.
        Los internos pueden saltarse la obligatoriedad de foto de bloque."""
        try:
            return request.env.user.has_group('base.group_user')
        except Exception:
            return False

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

    def partner_from_shipment(self, shipment):
        """Proveedor (partner) de un embarque vía proforma → OC. None si no se puede."""
        try:
            return shipment.proforma_id.purchase_id.partner_id or None
        except Exception:
            return None

    def _partner_origin_name(self, product, partner):
        """Nombre de origen ligado ESPECÍFICAMENTE a ese proveedor (o su empresa
        comercial / contacto padre, por si la OC usa un contacto hijo). '' si no hay."""
        tmpl = product.product_tmpl_id if product else None
        if not tmpl or not partner or "origin_name_ids" not in tmpl._fields:
            return ""
        partner_ids = {partner.id}
        commercial = getattr(partner, "commercial_partner_id", False)
        if commercial:
            partner_ids.add(commercial.id)
        parent = getattr(partner, "parent_id", False)
        if parent:
            partner_ids.add(parent.id)
        matches = tmpl.origin_name_ids.sorted("sequence").filtered(
            lambda o: o.partner_id and o.partner_id.id in partner_ids
        )
        return (matches[0].name or "") if matches else ""

    def portal_product_name(self, line):
        """Nombre del producto a mostrar en el portal, a partir de una línea de OC.

        Prioridad:
        1. Nombre de origen específico de ESE proveedor (lo más preciso).
        2. `display_name_override` del módulo product_origin_names (lo que el
           módulo decidió mostrar: nombre elegido en la línea o el prioritario).
        3. Nombre de origen genérico (sin proveedor) / nuestro nombre por defecto.
        """
        product = line.product_id if line else None
        default = (product.display_name or product.name) if product else ""
        if not product:
            return default
        partner = line.order_id.partner_id if (line and line.order_id) else None
        # 1. Específico del proveedor.
        name = self._partner_origin_name(product, partner)
        if name:
            return name
        # 2. Lo que el módulo decidió mostrar (selección por línea / prioritario).
        if line and "display_name_override" in line._fields and line.display_name_override:
            return line.display_name_override
        # 3. Genérico / default.
        return self.origin_name_for_partner(product, partner)

    def origin_name_for_partner(self, product, partner):
        """Nombre de origen para el proveedor: específico → genérico → nuestro nombre.

        Degrada con gracia si el módulo product_origin_names no está instalado.
        """
        default = (product.display_name or product.name) if product else ""
        name = self._partner_origin_name(product, partner)
        if name:
            return name
        tmpl = product.product_tmpl_id if product else None
        if not tmpl or "origin_name_ids" not in tmpl._fields or not tmpl.origin_name_ids:
            return default
        generic = tmpl.origin_name_ids.sorted("sequence").filtered(lambda o: not o.partner_id)
        if generic:
            return generic[0].name or default
        return default

    def _is_service_product(self, product):
        """Los productos de Servicio no se muestran en el portal del proveedor:
        se descartan por completo. Detección defensiva (tipo de producto,
        'Unidad del Producto' o la unidad de medida marcada como Servicio)."""
        if not product:
            return False
        # Tipo de producto = Servicio (estándar Odoo).
        if getattr(product, "type", False) == "service":
            return True
        tmpl = product.product_tmpl_id
        unidad = (getattr(tmpl, "x_unidad_del_producto", "") or "").strip().lower()
        if unidad == "servicio":
            return True
        uom = (product.uom_id.name or "").strip().lower() if product.uom_id else ""
        if uom == "servicio":
            return True
        return False

    def build_products_payload_from_purchase(self, purchase):
        """Productos pedidos. Acepta UNA o VARIAS OCs (factura de carga):
        el total por producto se SUMA a través de todas las líneas de todas
        las órdenes, usando la solicitud original congelada cuando existe
        (product_qty ya pudo haberse ajustado a lo embarcado)."""
        bucket = {}

        for line in purchase.order_line.filtered(lambda l: not l.display_type and l.product_id):
            product = line.product_id
            if self._is_service_product(product):
                continue
            if product.id not in bucket:
                unit_type = product.product_tmpl_id.x_unidad_del_producto or "Placa"
                bucket[product.id] = {
                    "id": product.id,
                    "name": self.portal_product_name(line),
                    "code": product.default_code or "",
                    "qty_ordered": 0.0,
                    "uom": (line.product_uom_id and line.product_uom_id.name) or "",
                    "unit_type": unit_type,
                }

            base_qty = line.x_qty_solicitada_original or line.product_qty or 0.0
            bucket[product.id]["qty_ordered"] += base_qty

        products = list(bucket.values())
        products.sort(key=lambda item: (item.get("name") or "").lower())
        return products

    def covered_purchase_orders(self, access):
        """POs amparadas por el enlace: las de la factura de carga, o la del
        access clásico. SIEMPRE devuelve recordset."""
        try:
            return access._covered_purchase_orders()
        except Exception:
            return access.purchase_id

    def ensure_headers_for_access(self, access):
        """Garantiza UNA proforma (PI) por cada PO amparada y las devuelve en
        el orden de las POs. Pre-llena el número de PI capturado en Compras."""
        pos = self.covered_purchase_orders(access)
        Header = request.env['supplier.proforma.header'].sudo()
        headers = Header
        for po in pos:
            header = Header.search([('purchase_id', '=', po.id)], limit=1)
            if not header:
                header = Header.create({
                    'purchase_id': po.id,
                    'access_id': access.id,
                    'proforma_number': po.supplier_pi_number or po.partner_ref or '',
                    'payment_terms': po.payment_term_id.name if po.payment_term_id else '',
                    'incoterm': po.incoterm_id.code if po.incoterm_id else '',
                })
            elif not header.access_id:
                header.write({'access_id': access.id})
            headers |= header
        return headers

    def sorted_shipments(self, shipment_records):
        return shipment_records.sorted("sequence")

    def sorted_packings(self, packing_records):
        return packing_records.sorted(lambda rec: (rec.packing_date or "", rec.id))