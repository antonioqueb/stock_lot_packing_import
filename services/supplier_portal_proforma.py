# -*- coding: utf-8 -*-

import json
import logging

from markupsafe import Markup
from odoo import fields
from odoo.http import request

from .supplier_portal_base import SupplierPortalBaseService
from .supplier_portal_documents import SupplierPortalDocumentsService
from .supplier_portal_sync import SupplierPortalSyncService

_logger = logging.getLogger(__name__)


class SupplierPortalProformaService(SupplierPortalBaseService):
    """
    Servicio principal del dominio portal:
    - token por OC
    - cabecera general por OC
    - múltiples embarques
    - una recepción por embarque
    """

    def __init__(self):
        self.documents_service = SupplierPortalDocumentsService()
        self.sync_service = SupplierPortalSyncService()

    # =====================================================================
    #  HELPERS DE VALIDACION
    # =====================================================================

    def _resolve_currency_id(self, currency_value):
        """
        Acepta:
        - currency_id numérico
        - código ISO como USD, MXN, EUR
        - símbolo o display_name como fallback
        y devuelve el id de res.currency.
        """
        Currency = request.env["res.currency"].sudo()

        if currency_value in (None, False, ""):
            return False

        try:
            if isinstance(currency_value, int) or str(currency_value).isdigit():
                currency_id = int(currency_value)
                currency = Currency.browse(currency_id)
                return currency.id if currency.exists() else False
        except Exception:
            pass

        code = str(currency_value).strip().upper()
        if not code:
            return False

        currency = Currency.search([("name", "=", code)], limit=1)
        if currency:
            return currency.id

        currency = Currency.search([("symbol", "=", code)], limit=1)
        if currency:
            return currency.id

        currency = Currency.search([("display_name", "ilike", code)], limit=1)
        if currency:
            return currency.id

        return False

    def _normalize_scope(self, scope):
        """
        Normaliza el alcance recibido desde el portal.

        Motivo:
        El prototipo React usa valores cortos como "full" y "specific",
        mientras que los modelos persistentes de Odoo guardan únicamente
        "full_shipment" y "specific_containers". Sin esta normalización,
        Odoo rechaza el create/write del invoice o packing y se corta toda
        la cadena de autoguardado antes de llegar a guardar el Packing List.
        """
        value = (str(scope or "").strip().lower())

        if value in ("specific", "specific_container", "specific_containers", "containers", "container"):
            return "specific_containers"

        if value in ("full", "full_shipment", "shipment", "all", "all_shipment", ""):
            return "full_shipment"

        _logger.warning("[Portal] Alcance no reconocido '%s'. Se usará full_shipment.", scope)
        return "full_shipment"


    def validate_container_ids_for_shipment(self, shipment, container_ids):
        normalized = self.normalize_id_list(container_ids)
        shipment_container_ids = set(shipment.container_ids.ids)
        invalid = [cid for cid in normalized if cid not in shipment_container_ids]
        if invalid:
            return False, "Uno o más contenedores no pertenecen al embarque actual."
        return True, normalized

    def validate_packing_scope_and_containers(self, shipment, packing_vals, rows=None):
        scope = self._normalize_scope(packing_vals.get("scope"))
        container_ids = self.normalize_id_list(packing_vals.get("container_ids", []))

        ok, result = self.validate_container_ids_for_shipment(shipment, container_ids)
        if not ok:
            return False, result, None

        valid_container_ids = result

        if scope == "specific_containers" and not valid_container_ids:
            return False, "Si el packing aplica a contenedores específicos, debe seleccionar al menos uno.", None

        if rows:
            shipment_container_ids = set(shipment.container_ids.ids)
            packing_container_ids = set(valid_container_ids)

            for idx, row in enumerate(rows, start=1):
                row_container_id = self.safe_int(row.get("container_id"), 0)
                if row_container_id:
                    if row_container_id not in shipment_container_ids:
                        return False, "La fila %s apunta a un contenedor que no pertenece al embarque." % idx, None
                    if scope == "specific_containers" and row_container_id not in packing_container_ids:
                        return False, "La fila %s usa un contenedor fuera del alcance del packing." % idx, None

        return True, "", valid_container_ids

    def compute_packing_derived_flags(self, packing):
        container_ids = packing.container_ids.ids
        row_container_ids = packing.row_ids.filtered(lambda row: row.container_id).mapped("container_id").ids
        row_container_ids = list(dict.fromkeys(row_container_ids))

        all_related_container_ids = list(dict.fromkeys(container_ids + row_container_ids))
        rows_without_container = packing.row_ids.filtered(lambda row: not row.container_id)
        is_single_container = len(all_related_container_ids) == 1
        is_multi_container = len(all_related_container_ids) > 1

        if is_single_container:
            suggested_mode = "container_first"
        elif is_multi_container:
            suggested_mode = "global_packing"
        else:
            suggested_mode = "unassigned"

        return {
            "container_count_derived": len(all_related_container_ids),
            "row_container_ids": row_container_ids,
            "all_related_container_ids": all_related_container_ids,
            "has_rows_without_container": bool(rows_without_container),
            "rows_without_container_count": len(rows_without_container),
            "is_single_container": is_single_container,
            "is_multi_container": is_multi_container,
            "suggested_mode": suggested_mode,
        }

    # =====================================================================
    #  BALANCE DE CANTIDADES
    # =====================================================================

    def _build_quantity_balance(self, proforma):
        if not proforma or not proforma.purchase_id:
            return []

        # Con factura de carga el pedido es la SUMA de todas las POs amparadas.
        access = proforma.access_id
        pos = self.covered_purchase_orders(access) if access else proforma.purchase_id
        ordered_map = self.sync_service._pos_ordered_qty_map(pos)

        current_map = {}
        for shipment in proforma.shipment_ids:
            ship_map = self.sync_service._shipment_qty_map(shipment)
            for pid, qty in ship_map.items():
                current_map[pid] = current_map.get(pid, 0.0) + qty

        product_line_map = {}
        for line in pos.order_line.filtered(lambda l: not l.display_type and l.product_id):
            if self._is_service_product(line.product_id):
                continue
            if line.product_id.id not in product_line_map:
                product_line_map[line.product_id.id] = line

        balance = []
        for pid, line in product_line_map.items():
            qty_ordered = ordered_map.get(pid, 0.0)
            qty_assigned = current_map.get(pid, 0.0)
            qty_diff = qty_assigned - qty_ordered

            balance.append({
                "product_id": pid,
                "product_name": self.portal_product_name(line),
                "product_code": line.product_id.default_code or "",
                "uom": line.product_uom_id.name or "",
                "qty_ordered": qty_ordered,
                "qty_assigned": qty_assigned,
                "qty_missing": max(0.0, qty_ordered - qty_assigned),
                "qty_excess": max(0.0, qty_assigned - qty_ordered),
                "is_under": bool(qty_assigned + 0.000001 < qty_ordered),
                "is_over": bool(qty_assigned - 0.000001 > qty_ordered),
                "is_exact": abs(qty_diff) <= 0.000001,
            })

        balance.sort(key=lambda item: (item.get("product_name") or "").lower())
        return balance

    # =====================================================================
    #  PROGRESO Y COMPLETITUD
    # =====================================================================

    def compute_progress(self, proforma):
        # Autosuficiente a propósito: el portal NO debe depender de un método del
        # modelo (que podría no estar recargado tras un deploy parcial). La torre
        # de control usa supplier.proforma.header._portal_progress(), que aplica
        # exactamente esta misma lógica.
        if not proforma:
            return {"percent": 0, "sections": {}}

        sections = {}
        total_weight = 0
        completed_weight = 0

        weight = 10
        total_weight += weight
        globals_filled = (
            bool(proforma.proforma_number)
            and bool(proforma.payment_terms)
            and bool(proforma.country_origin)
            and bool(proforma.incoterm)
        )
        if globals_filled:
            completed_weight += weight
        sections["globals"] = {"filled": globals_filled, "weight": weight}

        weight = 5
        total_weight += weight
        has_shipments = bool(proforma.shipment_ids)
        if has_shipments:
            completed_weight += weight
        sections["has_shipments"] = {"filled": has_shipments, "weight": weight}

        if not has_shipments:
            percent = round((completed_weight / total_weight) * 100) if total_weight else 0
            return {"percent": percent, "sections": sections}

        doc_model = request.env["supplier.shipment.document"].sudo()
        all_docs = doc_model.search([("shipment_id", "in", proforma.shipment_ids.ids)])
        doc_index_by_shipment = {}
        for doc in all_docs:
            if doc.shipment_id:
                doc_index_by_shipment.setdefault(doc.shipment_id, set()).add(doc.document_type)

        shipment_doc_types_required = ["bl", "invoice", "packing_list"]
        shipment_doc_types_extra = ["eur1", "certificate_origin", "fumigation"]

        for shipment in proforma.shipment_ids:
            prefix = "ship_%s" % shipment.id
            shipment_doc_types = doc_index_by_shipment.get(shipment.id, set())

            weight = 5
            total_weight += weight
            has_logistics = bool(shipment.vessel_name or shipment.shipping_line) and bool(shipment.etd or shipment.eta)
            if has_logistics:
                completed_weight += weight
            sections["%s_logistics" % prefix] = {"filled": has_logistics, "weight": weight}

            weight = 3
            total_weight += weight
            has_bl_info = bool(shipment.bl_number)
            if has_bl_info:
                completed_weight += weight
            sections["%s_bl_info" % prefix] = {"filled": has_bl_info, "weight": weight}

            weight = 3
            total_weight += weight
            has_containers = bool(shipment.container_ids)
            if has_containers:
                completed_weight += weight
            sections["%s_containers" % prefix] = {"filled": has_containers, "weight": weight}

            weight = 5
            total_weight += weight
            has_packings = bool(shipment.packing_ids) and any(pk.row_ids for pk in shipment.packing_ids)
            if has_packings:
                completed_weight += weight
            sections["%s_packings" % prefix] = {"filled": has_packings, "weight": weight}

            for doc_type in shipment_doc_types_required:
                weight = 8
                total_weight += weight
                has_doc = doc_type in shipment_doc_types
                if has_doc:
                    completed_weight += weight
                sections["%s_doc_%s" % (prefix, doc_type)] = {"filled": has_doc, "weight": weight}

            for doc_type in shipment_doc_types_extra:
                weight = 4
                total_weight += weight
                has_doc = doc_type in shipment_doc_types
                if has_doc:
                    completed_weight += weight
                sections["%s_doc_%s" % (prefix, doc_type)] = {"filled": has_doc, "weight": weight}

        percent = round((completed_weight / total_weight) * 100) if total_weight else 0
        return {"percent": percent, "sections": sections}

    def can_complete(self, proforma):
        if not proforma or not proforma.shipment_ids:
            return False, "Debe existir al menos un embarque."

        # Compra nacional: el portal solo pide Invoice y Packing List (sin B/L),
        # así que la validación de documentos obligatorios se ajusta igual.
        po = proforma.purchase_id
        is_national = bool(
            po and "purchase_payment_scope" in po._fields
            and po.purchase_payment_scope == "national"
        )

        doc_model = request.env["supplier.shipment.document"].sudo()
        # Nacional: no se cargan documentos (ni invoice ni BL); el Packing List
        # se GENERA en el portal, no se sube como archivo. Nada obligatorio.
        required_per_shipment = (
            [] if is_national
            else ["bl", "invoice", "packing_list"]
        )

        all_docs = doc_model.search([
            ("shipment_id", "in", proforma.shipment_ids.ids),
        ])

        doc_index_by_shipment = {}
        for doc in all_docs:
            if doc.shipment_id:
                doc_index_by_shipment.setdefault(doc.shipment_id, set()).add(doc.document_type)

        for shipment in proforma.shipment_ids:
            shipment_doc_types = doc_index_by_shipment.get(shipment.id, set())
            for doc_type in required_per_shipment:
                if doc_type not in shipment_doc_types:
                    labels = {
                        "bl": "B/L",
                        "invoice": "Invoice",
                        "packing_list": "Packing List",
                    }
                    return False, 'El embarque "%s" no tiene el documento obligatorio: %s' % (
                        shipment.name,
                        labels.get(doc_type, doc_type),
                    )

        return True, ""

    # =====================================================================
    #  SERIALIZACION
    # =====================================================================

    def serialize_packing_for_response(self, packing):
        """
        LIVE-PORTAL-005:
        Payload completo para reconciliar un Packing List recién creado o guardado
        sin depender únicamente de un reload posterior del portal.
        """
        derived = self.compute_packing_derived_flags(packing)

        rows_payload = []
        for row in packing.row_ids.sorted("sequence"):
            rows_payload.append({
                "id": row.id,
                "product_id": row.product_id.id,
                "product_name": self.origin_name_for_partner(row.product_id, self.partner_from_shipment(packing.shipment_id)),
                "container_id": row.container_id.id if row.container_id else False,
                "container_number": row.container_id.container_number if row.container_id else "",
                "tipo": row.tipo or "Placa",
                "grosor": row.grosor or "",
                "alto": row.alto,
                "ancho": row.ancho,
                "peso": row.peso,
                "quantity": row.quantity,
                "bloque": row.bloque or "",
                "numero_placa": row.numero_placa or "",
                "atado": row.atado or "",
                "color": row.color or "",
                "grupo_name": row.grupo_name or "",
                "pedimento": row.pedimento or "",
                "ref_proveedor": row.ref_proveedor or "",
                "area_m2": row.area_m2,
                "has_image": bool(row.image),
                "pi_header_id": row.pi_header_id.id if row.pi_header_id else False,
                "pi_number": row.pi_header_id.proforma_number if row.pi_header_id else "",
                "pi_manual": bool(row.pi_manual),
            })

        return {
            "id": packing.id,
            "packing_number": packing.packing_number or "",
            "packing_date": str(packing.packing_date) if packing.packing_date else "",
            "scope": packing.scope or "full_shipment",
            "container_ids": packing.container_ids.ids,
            "row_count": packing.row_count,
            "rows": rows_payload,
            "container_count_derived": derived["container_count_derived"],
            "row_container_ids": derived["row_container_ids"],
            "all_related_container_ids": derived["all_related_container_ids"],
            "has_rows_without_container": derived["has_rows_without_container"],
            "rows_without_container_count": derived["rows_without_container_count"],
            "is_single_container": derived["is_single_container"],
            "is_multi_container": derived["is_multi_container"],
            "suggested_mode": derived["suggested_mode"],
        }

    def _get_shipment_picking(self, shipment):
        return request.env["stock.picking"].sudo().search(
            [("supplier_shipment_id", "=", shipment.id)],
            order="id desc",
            limit=1,
        )

    def _shipment_catalog_vals(self, shipment_data):
        """Naviera/forwarder del CATÁLOGO del tarifario. Al elegir naviera,
        el Char shipping_line se sincroniza con su nombre (reportes/vistas
        existentes siguen funcionando)."""
        vals = {}
        for key in ("naviera_id", "forwarder_id"):
            if key in (shipment_data or {}):
                pid = self.safe_int(shipment_data.get(key), 0)
                vals[key] = pid or False
                if key == "naviera_id" and pid:
                    partner = request.env["res.partner"].sudo().browse(pid)
                    if partner.exists():
                        vals["shipping_line"] = partner.name
        return vals

    def _tariff_catalogs(self):
        """Catálogos de navieras y forwarders CON TARIFA ACTIVA (el
        tarifario es la única fuente). Vacíos si el módulo no está."""
        try:
            tariffs = request.env["freight.tariff"].sudo().search(
                [("state", "=", "active")])
            navieras = [
                {"id": p.id, "name": p.name}
                for p in tariffs.mapped("naviera_id").sorted("name")
            ]
            forwarders = [
                {"id": p.id, "name": p.name}
                for p in tariffs.mapped("forwarder_id").sorted("name")
            ]
            return navieras, forwarders
        except Exception:
            return [], []

    def serialize_proforma(self, header):
        shipments = []

        for shipment in self.sorted_shipments(header.shipment_ids):
            picking = self._get_shipment_picking(shipment)
            shipment_products = self.sync_service.build_products_payload_for_shipment(shipment)

            containers = [{
                "id": container.id,
                "container_number": container.container_number or "",
                "seal_number": container.seal_number or "",
                "container_type": container.container_type or "",
                "weight": container.weight or 0.0,
                "volume": container.volume or 0.0,
                "packages": container.packages or 0,
                "notes": container.notes or "",
                "packing_ids": container.packing_ids.ids if "packing_ids" in container._fields else [],
            } for container in shipment.container_ids]

            invoices = [{
                "id": invoice.id,
                "invoice_number": invoice.invoice_number or "",
                "invoice_date": str(invoice.invoice_date) if invoice.invoice_date else "",
                "amount": invoice.amount or 0.0,
                "currency_id": invoice.currency_id.id if invoice.currency_id else False,
                "currency_name": invoice.currency_id.name if invoice.currency_id else "",
                "scope": invoice.scope or "full_shipment",
                "container_ids": invoice.container_ids.ids,
                "is_multi_container": len(invoice.container_ids.ids) > 1,
            } for invoice in shipment.invoice_ids]

            packings = [
                self.serialize_packing_for_response(packing)
                for packing in self.sorted_packings(shipment.packing_ids)
            ]

            shipment_container_ids = set(shipment.container_ids.ids)
            packing_related_container_ids = set()
            containers_without_packing = []

            for packing in self.sorted_packings(shipment.packing_ids):
                derived = self.compute_packing_derived_flags(packing)
                packing_related_container_ids.update(derived["all_related_container_ids"])

            for container in shipment.container_ids:
                if container.id not in packing_related_container_ids:
                    containers_without_packing.append(container.id)

            block_images = []
            if hasattr(shipment, "block_image_ids"):
                block_images = [{
                    "id": image.id,
                    "block_name": image.block_name or "",
                    "product_id": image.product_id.id,
                    "product_name": self.origin_name_for_partner(image.product_id, self.partner_from_shipment(shipment)),
                    "has_image": bool(image.image),
                    "image_filename": image.image_filename or "",
                    "notes": image.notes or "",
                } for image in shipment.block_image_ids]

            shipment_documents = self.documents_service.serialize_documents_for_scope(shipment_id=shipment.id)

            shipments.append({
                "id": shipment.id,
                "name": shipment.name or "",
                "sequence": shipment.sequence,
                "shipment_type": shipment.shipment_type or "maritime",
                "shipping_line": shipment.shipping_line or "",
                "naviera_id": shipment.naviera_id.id if getattr(shipment, 'naviera_id', False) else False,
                "forwarder_id": shipment.forwarder_id.id if getattr(shipment, 'forwarder_id', False) else False,
                "vessel_name": shipment.vessel_name or "",
                "etd": str(shipment.etd) if shipment.etd else "",
                "eta": str(shipment.eta) if shipment.eta else "",
                "port_origin": shipment.port_origin or "",
                "port_destination": shipment.port_destination or "",
                "bl_number": shipment.bl_number or "",
                "bl_date": str(shipment.bl_date) if shipment.bl_date else "",
                "status": shipment.status or "draft",
                "notes": shipment.notes or "",
                "container_count": shipment.container_count,
                "invoice_count": shipment.invoice_count,
                "packing_count": shipment.packing_count,
                "invoices": invoices,
                "packings": packings,
                "containers": containers,
                "block_images": block_images,
                "voyage_id": shipment.voyage_id.id if shipment.voyage_id else False,
                "containers_without_packing": containers_without_packing,
                "has_multi_container_packings": any(item["is_multi_container"] for item in packings),
                "has_packings_without_container": any(item["has_rows_without_container"] for item in packings),
                "all_container_ids": list(shipment_container_ids),
                "documents": shipment_documents,
                "picking_id": picking.id if picking else False,
                "picking_name": picking.name if picking else "",
                "picking_state": picking.state if picking else "",
                "products": shipment_products,
            })

        progress = self.compute_progress(header)
        quantity_balance = self._build_quantity_balance(header)

        return {
            "id": header.id,
            "proforma_number": header.proforma_number or "",
            "invoice_global_number": header.invoice_global_number or "",
            "payment_terms": header.payment_terms or "",
            "country_origin": header.country_origin or "",
            "port_origin": header.port_origin or "" if "port_origin" in header._fields else "",
            "port_destination": header.port_destination or "" if "port_destination" in header._fields else "",
            "incoterm": header.incoterm or "",
            "general_notes": header.general_notes or "",
            "status": header.status or "draft",
            "shipments": shipments,
            "global_documents": [],
            "progress": progress,
            "quantity_balance": quantity_balance,
            "is_internal": self.is_internal_user(),
        }

    # =====================================================================
    #  PORTAL PAYLOAD / VIEW
    # =====================================================================

    def build_portal_view(self, token):
        access = self.validate_token(token)
        if not access:
            return request.render("stock_lot_packing_import.portal_not_found")

        if access.is_expired:
            return request.render("stock_lot_packing_import.portal_expired")

        po = access.purchase_id
        if not po:
            return request.render("stock_lot_packing_import.portal_not_found")

        # Factura de carga: el enlace ampara VARIAS POs. Los productos y sus
        # totales se suman a través de todas; además se garantiza una PI por
        # PO y se publican al frontend para la asignación por fila.
        covered_pos = self.covered_purchase_orders(access)
        headers = self.ensure_headers_for_access(access)
        products = self.build_products_payload_from_purchase(covered_pos)
        proforma = self.get_or_create_proforma(access)
        proforma_data = self.serialize_proforma(proforma) if proforma else {}

        header_by_po = {h.purchase_id.id: h for h in headers}
        proformas_payload = []
        for po_it in covered_pos:
            header = header_by_po.get(po_it.id)
            if not header:
                continue
            pi_product_ids = list(dict.fromkeys(
                line.product_id.id
                for line in po_it.order_line
                if not line.display_type and line.product_id
                and not self._is_service_product(line.product_id)
            ))
            proformas_payload.append({
                "id": header.id,
                "number": header.proforma_number
                          or po_it.partner_ref or po_it.name or "",
                "po_id": po_it.id,
                "po_name": po_it.name or "",
                "is_main": bool(proforma and header.id == proforma.id),
                # Productos que ampara esta PI: el selector por fila del PL
                # solo ofrece PIs que CONTIENEN el material de la fila.
                "product_ids": pi_product_ids,
            })

        full_data = {
            "products": products,
            "existing_rows": [],
            "header": {
                "proforma_number": proforma.proforma_number or "" if proforma else "",
                "invoice_number": proforma.invoice_global_number or "" if proforma else "",
                "payment_terms": proforma.payment_terms or "" if proforma else "",
                "country_origin": proforma.country_origin or "" if proforma else "",
                "port_origin": proforma.port_origin or "" if proforma and "port_origin" in proforma._fields else "",
                "port_destination": proforma.port_destination or "" if proforma and "port_destination" in proforma._fields else "",
                "incoterm": proforma.incoterm or "" if proforma else "",
                "general_notes": proforma.general_notes or "" if proforma else "",
            },
            "proforma": proforma_data,
            "proformas": proformas_payload,
            "navieras": self._tariff_catalogs()[0],
            "forwarders": self._tariff_catalogs()[1],
            "is_cargo": len(covered_pos) > 1,
            "token": token,
            "poName": " · ".join(covered_pos.mapped("name")) or (po.name or ""),
            "pickingName": "",
            "vendor_name": po.partner_id.name or "",
            "companyName": po.company_id.name or "",
            "apiVersion": 2,
            # Solo lectura: indica si la OC es compra nacional (campo del módulo
            # somgroup_purchase_payment_terms). El backend no cambia su lógica;
            # el portal usa este flag únicamente para ajustar la vista del
            # proveedor (nombres, pasos y columnas). Si el campo no existe
            # (módulo no instalado), el portal se comporta como internacional.
            "is_national": bool(
                "purchase_payment_scope" in po._fields
                and po.purchase_payment_scope == "national"
            ),
            # Usuario interno con sesión activa: el portal le permite saltarse la
            # obligatoriedad de foto de bloque (el proveedor externo no).
            "is_internal": self.is_internal_user(),
        }

        values = {
            "portal_json": Markup(json.dumps(full_data, ensure_ascii=False)),
        }
        return request.render("stock_lot_packing_import.supplier_portal_view", values)

    # =====================================================================
    #  GLOBALS
    # =====================================================================

    def save_globals(self, token, globals_data):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        if not proforma:
            return {"success": False, "message": "No se pudo crear la proforma."}

        vals = {}
        field_map = {
            "proforma_number": "proforma_number",
            "invoice_global_number": "invoice_global_number",
            "payment_terms": "payment_terms",
            "country_origin": "country_origin",
            "port_origin": "port_origin",
            "port_destination": "port_destination",
            "incoterm": "incoterm",
            "general_notes": "general_notes",
        }

        if globals_data:
            for js_key, py_field in field_map.items():
                if js_key in globals_data and py_field in proforma._fields:
                    vals[py_field] = globals_data[js_key] or ""

        if vals:
            proforma.write(vals)

        # Mantener ruta global alineada con cada embarque existente.
        # El frontend captura origen/destino en Datos Globales; el modelo operativo
        # del embarque también los necesita para serializar, sincronizar recepción
        # y persistir al refrescar.
        if globals_data and proforma.shipment_ids:
            shipment_vals = {}
            if "port_origin" in globals_data and "port_origin" in proforma.shipment_ids._fields:
                shipment_vals["port_origin"] = globals_data.get("port_origin") or ""
            if "port_destination" in globals_data and "port_destination" in proforma.shipment_ids._fields:
                shipment_vals["port_destination"] = globals_data.get("port_destination") or ""
            if shipment_vals:
                proforma.shipment_ids.write(shipment_vals)

        # SINCRONIZAR HACIA ORDEN DE COMPRA
        po = proforma.purchase_id
        if po and globals_data:
            po_vals = {}
            if 'proforma_number' in globals_data:
                po_vals['partner_ref'] = globals_data['proforma_number']
                
            if 'payment_terms' in globals_data and globals_data['payment_terms']:
                term = request.env['account.payment.term'].sudo().search([('name', 'ilike', globals_data['payment_terms'])], limit=1)
                if term:
                    po_vals['payment_term_id'] = term.id
                    
            if 'incoterm' in globals_data and globals_data['incoterm']:
                incoterm = request.env['account.incoterms'].sudo().search([('code', 'ilike', globals_data['incoterm'])], limit=1)
                if incoterm:
                    po_vals['incoterm_id'] = incoterm.id
                    
            if po_vals:
                po.with_context(skip_global_sync=True).write(po_vals)

        self.sync_service.sync_all_shipments(proforma)
        return {"success": True, "proforma_id": proforma.id}

    # =====================================================================
    #  SHIPMENTS
    # =====================================================================

    def create_shipment(self, token, shipment_data):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        if not proforma:
            return {"success": False, "message": "Proforma no encontrada."}

        vals = {"proforma_id": proforma.id}
        if shipment_data:
            for key in [
                "shipment_type",
                "shipping_line",
                "vessel_name",
                "port_origin",
                "port_destination",
                "bl_number",
                "notes",
            ]:
                if key in shipment_data:
                    vals[key] = shipment_data[key] or ""
            vals.update(self._shipment_catalog_vals(shipment_data))

            for key in ["etd", "eta", "bl_date"]:
                if shipment_data.get(key):
                    vals[key] = shipment_data[key]

            if "status" in shipment_data:
                vals["status"] = shipment_data["status"]

        shipment = request.env["supplier.shipment"].sudo().create(vals)
        proforma.write({"status": "partial"})

        picking = self.sync_service.get_or_create_picking_for_shipment(shipment)
        self.sync_service.sync_shipment_header_to_picking(shipment)

        return {
            "success": True,
            "shipment_id": shipment.id,
            "name": shipment.name,
            "picking_id": picking.id if picking else False,
        }

    def update_shipment(self, token, shipment_id, shipment_data):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        shipment = request.env["supplier.shipment"].sudo().browse(self.safe_int(shipment_id))
        if not shipment.exists() or not self.belongs_to_proforma(proforma, shipment=shipment):
            return {"success": False, "message": "Embarque no encontrado o no autorizado."}

        vals = {}
        if shipment_data:
            for key in [
                "shipment_type",
                "shipping_line",
                "vessel_name",
                "port_origin",
                "port_destination",
                "bl_number",
                "notes",
                "status",
            ]:
                if key in shipment_data:
                    vals[key] = shipment_data[key] if key == "status" else (shipment_data[key] or "")

            for key in ["etd", "eta", "bl_date"]:
                if key in shipment_data:
                    vals[key] = shipment_data[key] or False

            vals.update(self._shipment_catalog_vals(shipment_data))

        if vals:
            shipment.write(vals)

        self.sync_service.sync_shipment(shipment)
        return {"success": True}

    def delete_shipment(self, token, shipment_id):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        shipment = request.env["supplier.shipment"].sudo().browse(self.safe_int(shipment_id))
        if not shipment.exists() or not self.belongs_to_proforma(proforma, shipment=shipment):
            return {"success": False, "message": "Embarque no encontrado o no autorizado."}

        if not self.sync_service.delete_picking_for_shipment(shipment):
            return {
                "success": False,
                "message": "No se puede eliminar el embarque porque su recepción ya fue procesada o no pudo limpiarse.",
            }

        shipment.unlink()

        if proforma and not proforma.shipment_ids:
            proforma.write({"status": "draft"})

        return {"success": True}

    # =====================================================================
    #  CONTAINERS
    # =====================================================================

    def save_containers(self, token, shipment_id, containers):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        shipment = request.env["supplier.shipment"].sudo().browse(self.safe_int(shipment_id))
        if not shipment.exists() or not self.belongs_to_proforma(proforma, shipment=shipment):
            return {"success": False, "message": "Embarque no encontrado o no autorizado."}

        container_model = request.env["supplier.shipment.container"].sudo()
        existing_ids = set()

        for container in (containers or []):
            container_id = self.safe_int(container.get("id"), 0)
            vals = {
                "container_number": container.get("container_number", ""),
                "seal_number": container.get("seal_number", ""),
                "container_type": container.get("container_type", ""),
                "weight": self.safe_float(container.get("weight", 0)),
                "volume": self.safe_float(container.get("volume", 0)),
                "packages": self.safe_int(container.get("packages", 0)),
                "notes": container.get("notes", ""),
            }

            if container_id:
                record = container_model.browse(container_id)
                if not record.exists() or record.shipment_id.id != shipment.id:
                    return {"success": False, "message": "Uno de los contenedores no pertenece al embarque actual."}
                record.write(vals)
                existing_ids.add(record.id)
            else:
                vals["shipment_id"] = shipment.id
                new_record = container_model.create(vals)
                existing_ids.add(new_record.id)

        to_delete = shipment.container_ids.filtered(lambda rec: rec.id not in existing_ids)
        if to_delete:
            used_in_packings = request.env["supplier.shipment.packing"].sudo().search([
                ("shipment_id", "=", shipment.id),
                ("container_ids", "in", to_delete.ids),
            ], limit=1)
            used_in_rows = request.env["supplier.shipment.packing.row"].sudo().search([
                ("container_id", "in", to_delete.ids),
                ("packing_id.shipment_id", "=", shipment.id),
            ], limit=1)
            used_in_invoices = request.env["supplier.shipment.invoice"].sudo().search([
                ("shipment_id", "=", shipment.id),
                ("container_ids", "in", to_delete.ids),
            ], limit=1)

            if used_in_packings or used_in_rows or used_in_invoices:
                return {
                    "success": False,
                    "message": "No puede eliminar contenedores que ya están siendo usados en packings, filas o invoices.",
                }
            to_delete.unlink()

        self.sync_service.sync_shipment_header_to_picking(shipment)
        self.sync_service.sync_shipment(shipment)

        containers_payload = [{
            "id": container.id,
            "container_number": container.container_number or "",
            "seal_number": container.seal_number or "",
            "container_type": container.container_type or "",
            "weight": container.weight or 0.0,
            "volume": container.volume or 0.0,
            "packages": container.packages or 0,
            "notes": container.notes or "",
        } for container in shipment.container_ids.sorted("id")]

        return {
            "success": True,
            "container_ids": [item["id"] for item in containers_payload],
            "containers": containers_payload,
        }

    # =====================================================================
    #  INVOICES
    # =====================================================================

    def save_invoices(self, token, shipment_id, invoices):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        shipment = request.env["supplier.shipment"].sudo().browse(self.safe_int(shipment_id))
        if not shipment.exists() or not self.belongs_to_proforma(proforma, shipment=shipment):
            return {"success": False, "message": "Embarque no encontrado o no autorizado."}

        invoice_model = request.env["supplier.shipment.invoice"].sudo()
        existing_ids = set()

        po_currency_id = False
        if shipment.proforma_id and shipment.proforma_id.purchase_id and shipment.proforma_id.purchase_id.currency_id:
            po_currency_id = shipment.proforma_id.purchase_id.currency_id.id

        company_currency_id = request.env.company.currency_id.id if request.env.company.currency_id else False

        for invoice in (invoices or []):
            invoice_id = self.safe_int(invoice.get("id"), 0)
            scope = self._normalize_scope(invoice.get("scope"))
            container_ids = self.normalize_id_list(invoice.get("container_ids", []))

            ok, result = self.validate_container_ids_for_shipment(shipment, container_ids)
            if not ok:
                return {"success": False, "message": result}

            if scope == "specific_containers" and not result:
                return {
                    "success": False,
                    "message": "Si el invoice aplica a contenedores específicos, debe seleccionar al menos un contenedor.",
                }

            currency_id = False

            if invoice.get("currency_id"):
                currency_id = self._resolve_currency_id(invoice.get("currency_id"))

            if not currency_id and invoice.get("currency_name"):
                currency_id = self._resolve_currency_id(invoice.get("currency_name"))

            existing_record = invoice_model.browse(invoice_id) if invoice_id else invoice_model

            if not currency_id and invoice_id and existing_record.exists() and existing_record.currency_id:
                currency_id = existing_record.currency_id.id

            if not currency_id:
                currency_id = po_currency_id or company_currency_id

            vals = {
                "invoice_number": invoice.get("invoice_number", ""),
                "invoice_date": invoice.get("invoice_date") or False,
                "amount": self.safe_float(invoice.get("amount", 0)),
                "scope": scope,
                "container_ids": [(6, 0, result)],
                "currency_id": currency_id or False,
            }

            if invoice_id:
                record = invoice_model.browse(invoice_id)
                if not record.exists() or not self.belongs_to_proforma(proforma, invoice=record):
                    return {"success": False, "message": "Uno de los invoices no pertenece a la proforma actual."}
                record.write(vals)
                existing_ids.add(record.id)
            else:
                vals["shipment_id"] = shipment.id
                new_record = invoice_model.create(vals)
                existing_ids.add(new_record.id)

        to_delete = shipment.invoice_ids.filtered(lambda rec: rec.id not in existing_ids)
        if to_delete:
            to_delete.unlink()

        invoices_payload = [{
            "id": invoice.id,
            "invoice_number": invoice.invoice_number or "",
            "invoice_date": str(invoice.invoice_date) if invoice.invoice_date else "",
            "amount": invoice.amount or 0.0,
            "currency_id": invoice.currency_id.id if invoice.currency_id else False,
            "currency_name": invoice.currency_id.name if invoice.currency_id else "",
            "scope": invoice.scope or "full_shipment",
            "container_ids": invoice.container_ids.ids,
        } for invoice in shipment.invoice_ids.sorted("id")]

        return {
            "success": True,
            "invoice_ids": [item["id"] for item in invoices_payload],
            "invoices": invoices_payload,
        }

    # =====================================================================
    #  PACKINGS
    # =====================================================================

    def save_packing(self, token, shipment_id, packing_data, rows):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        shipment = request.env["supplier.shipment"].sudo().browse(self.safe_int(shipment_id))
        if not shipment.exists() or not self.belongs_to_proforma(proforma, shipment=shipment):
            return {"success": False, "message": "Embarque no encontrado o no autorizado."}

        if not packing_data:
            packing_data = {}

        packing_model = request.env["supplier.shipment.packing"].sudo()
        row_model = request.env["supplier.shipment.packing.row"].sudo()

        packing_id = self.safe_int(packing_data.get("id"), 0)
        packing = False

        if packing_id:
            packing = packing_model.browse(packing_id)
            if not packing.exists() or not self.belongs_to_proforma(proforma, packing=packing):
                return {"success": False, "message": "Packing no encontrado o no autorizado."}

        # AUTO-PL-001:
        # El autosave puede enviar solo filas. Si no vienen metadatos explícitos,
        # se conserva el valor existente para no borrar número, fecha, alcance
        # ni contenedores por accidente.
        raw_scope = (
            packing_data.get("scope")
            or (packing.scope if packing else "full_shipment")
            or "full_shipment"
        )
        scope = self._normalize_scope(raw_scope)
        raw_container_ids = (
            packing_data.get("container_ids")
            if "container_ids" in packing_data
            else (packing.container_ids.ids if packing else [])
        )
        packing_number = (
            packing_data.get("packing_number")
            if "packing_number" in packing_data
            else (packing.packing_number if packing else "")
        )
        packing_date = (
            packing_data.get("packing_date")
            if "packing_date" in packing_data
            else (packing.packing_date if packing else False)
        )

        # Compra nacional: el folio del PL no es obligatorio (solo la fecha).
        # El modelo lo exige, así que se autogenera uno estable desde la fecha.
        if not (packing_number or "").strip():
            proforma_rec = shipment.proforma_id
            po_rec = proforma_rec.purchase_id if proforma_rec else False
            is_national_po = bool(
                po_rec and 'purchase_payment_scope' in po_rec._fields
                and po_rec.purchase_payment_scope == 'national'
            )
            if is_national_po:
                base = 'PL-%s' % (packing_date or fields.Date.context_today(shipment))
                existing = shipment.packing_ids.filtered(
                    lambda pk: (pk.packing_number or '').startswith(base)
                    and (not packing or pk.id != packing.id)
                )
                packing_number = base if not existing else '%s-%d' % (base, len(existing) + 1)

        packing_vals = {
            "packing_number": packing_number or "",
            "packing_date": packing_date or False,
            "scope": scope,
            "container_ids": raw_container_ids,
        }

        ok, msg, normalized_container_ids = self.validate_packing_scope_and_containers(
            shipment,
            packing_vals,
            rows=rows or [],
        )
        if not ok:
            return {"success": False, "message": msg}

        vals = {
            "packing_number": packing_number or "",
            "packing_date": packing_date or False,
            "scope": scope,
            "container_ids": [(6, 0, normalized_container_ids)],
        }

        if packing:
            packing.write(vals)
        else:
            vals["shipment_id"] = shipment.id
            packing = packing_model.create(vals)

        saved_rows_response = []

        # BLINDAJE ANTI-BORRADO: un guardado con la lista de filas VACÍA sobre
        # un packing que SÍ tiene filas en el servidor nunca es una captura
        # legítima (borrar el PL completo tiene su propio endpoint explícito).
        # Es el patrón de un autosave con estado corrupto/reiniciado del
        # frontend: se ignoran las filas (se conserva lo del servidor) y el
        # portal se reconcilia con la verdad de Odoo en el siguiente reload.
        if rows is not None and not rows and packing.row_ids:
            _logger.warning(
                "[Portal][GUARD] save_packing recibió 0 filas para el packing %s "
                "(%s filas en servidor). Se IGNORA el borrado masivo.",
                packing.id, len(packing.row_ids),
            )
            rows = None

        if rows is not None:
            existing_rows = {row.id: row for row in packing.row_ids}
            incoming_ids = set()
            sequence = 10

            shipment_container_ids = set(shipment.container_ids.ids)
            packing_container_ids = set(normalized_container_ids)

            # PIs válidas para asignación manual por fila: las proformas de
            # las POs amparadas por este enlace.
            allowed_header_ids = set(self.ensure_headers_for_access(access).ids)

            for idx, row in enumerate(rows, start=1):
                row_id = self.safe_int(row.get("id"), 0)
                row_container_id = self.safe_int(row.get("container_id"), 0)
                client_id = row.get("_client_id") or row.get("client_id") or row.get("_id") or ""

                if row_container_id and row_container_id not in shipment_container_ids:
                    return {
                        "success": False,
                        "message": "La fila %s contiene un contenedor inválido para este embarque." % idx,
                    }

                if scope == "specific_containers" and row_container_id and row_container_id not in packing_container_ids:
                    return {
                        "success": False,
                        "message": "La fila %s contiene un contenedor fuera del alcance del packing." % idx,
                    }

                row_vals = {
                    "packing_id": packing.id,
                    "sequence": sequence,
                    "product_id": self.safe_int(row.get("product_id"), 0),
                    "container_id": row_container_id or False,
                    "tipo": row.get("tipo", "Placa"),
                    "grosor": row.get("grosor", ""),
                    "alto": self.safe_float(row.get("alto", 0)),
                    "ancho": self.safe_float(row.get("ancho", 0)),
                    "peso": self.safe_float(row.get("peso", 0)),
                    "quantity": self.safe_float(row.get("quantity", 0)),
                    "bloque": row.get("bloque", ""),
                    "numero_placa": row.get("numero_placa", ""),
                    "atado": row.get("atado", ""),
                    "color": row.get("color", ""),
                    "grupo_name": row.get("grupo_name", ""),
                    "pedimento": row.get("pedimento", ""),
                    "ref_proveedor": row.get("ref_proveedor", ""),
                }

                # Asignación MANUAL de PI por fila (misma mecánica que el
                # contenedor). Si no viene, la fila queda para el FIFO.
                if "pi_header_id" in row:
                    pi_header_id = self.safe_int(row.get("pi_header_id"), 0)
                    if pi_header_id and pi_header_id not in allowed_header_ids:
                        return {
                            "success": False,
                            "message": "La fila %s contiene una PI que no pertenece a esta carga." % idx,
                        }
                    # La PI elegida debe CONTENER el producto de la fila: una
                    # PI sin ese material provocaría un reparto imposible.
                    if pi_header_id and row_vals.get("product_id"):
                        pi_header = request.env["supplier.proforma.header"].sudo().browse(pi_header_id)
                        pi_po = pi_header.purchase_id
                        has_product = pi_po and any(
                            not l.display_type
                            and l.product_id.id == row_vals["product_id"]
                            for l in pi_po.order_line
                        )
                        if not has_product:
                            return {
                                "success": False,
                                "message": "La fila %s asigna una PI que no contiene ese producto." % idx,
                            }
                    row_vals["pi_header_id"] = pi_header_id or False
                    row_vals["pi_manual"] = bool(pi_header_id)

                if not row_vals["product_id"]:
                    return {"success": False, "message": "Todas las filas deben tener producto."}

                if row_id:
                    row_record = existing_rows.get(row_id)
                    if not row_record:
                        return {"success": False, "message": "Una de las filas no pertenece al packing actual."}
                    # BLINDAJE ANTI-BORRADO (2): si la fila YA tiene medidas
                    # capturadas en el servidor y el guardado llega con TODO en
                    # cero (alto, ancho y cantidad), es el patrón de un autosave
                    # con estado reiniciado — no una corrección legítima (para
                    # quitar una fila está el botón de eliminar fila). Se
                    # conservan las medidas del servidor y se registra en log.
                    incoming_empty = (
                        not row_vals.get("alto")
                        and not row_vals.get("ancho")
                        and not row_vals.get("quantity")
                    )
                    server_has_data = bool(
                        row_record.alto or row_record.ancho or row_record.quantity
                    )
                    if incoming_empty and server_has_data:
                        _logger.warning(
                            "[Portal][GUARD] Fila %s del packing %s llegó SIN "
                            "medidas (servidor: alto=%s ancho=%s qty=%s). Se "
                            "conservan los valores del servidor.",
                            row_record.id, packing.id,
                            row_record.alto, row_record.ancho, row_record.quantity,
                        )
                        for key in ("alto", "ancho", "quantity", "peso"):
                            row_vals.pop(key, None)
                    row_record.write(row_vals)
                else:
                    row_record = row_model.create(row_vals)

                incoming_ids.add(row_record.id)
                saved_rows_response.append({
                    "client_id": str(client_id or ""),
                    "id": row_record.id,
                    "has_image": bool(row_record.image),
                })

                sequence += 10

            rows_to_delete = packing.row_ids.filtered(lambda rec: rec.id not in incoming_ids)
            if rows_to_delete:
                rows_to_delete.unlink()

        # AUTO-PL-002:
        # El PL se guarda automáticamente aunque falten fotos por bloque.
        # La exigencia final de fotos se mantiene en complete_proforma().
        self.sync_service.sync_shipment(shipment)

        # Aviso de saldo (NO bloqueante): si lo capturado supera lo pedido en
        # las PO/PI amparadas, se informa pero se permite guardar (el exceso
        # embarcado es una realidad operativa que se cobra aparte).
        balance_warnings = []
        try:
            remaining = self.sync_service._remaining_qty_map_for_shipment(shipment)
            current = self.sync_service._shipment_qty_map(shipment)
            for pid, qty in current.items():
                rem = remaining.get(pid)
                if rem is None:
                    continue
                over = qty - rem
                if over > 1e-4:
                    product = request.env["product.product"].sudo().browse(pid)
                    balance_warnings.append(
                        "%s: capturado %.2f %s por ENCIMA de lo pedido en la "
                        "PO/PI." % (
                            product.display_name, over,
                            product.uom_id.name or "",
                        )
                    )
        except Exception:
            _logger.exception("[Portal] No se pudo calcular el aviso de saldo PL.")

        return {
            "success": True,
            "packing_id": packing.id,
            "row_ids": packing.row_ids.ids,
            "rows": saved_rows_response,
            "balance_warnings": balance_warnings,
            # LIVE-PORTAL-005:
            # Se devuelve el objeto serializado para que el frontend pueda
            # reconciliar la UI optimista aun si el reload posterior tarda.
            "packing": self.serialize_packing_for_response(packing),
            "progress": self.compute_progress(proforma),
        }

    def delete_packing(self, token, packing_id):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        packing = request.env["supplier.shipment.packing"].sudo().browse(self.safe_int(packing_id))
        if not packing.exists() or not self.belongs_to_proforma(proforma, packing=packing):
            return {"success": False, "message": "Packing no encontrado o no autorizado."}

        shipment = packing.shipment_id
        packing.unlink()
        self.sync_service.sync_shipment(shipment)
        return {"success": True}

    # =====================================================================
    #  COMPLETE / RELOAD
    # =====================================================================

    def complete_proforma(self, token):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        if not proforma:
            return {"success": False, "message": "Proforma no encontrada."}

        # Compra nacional: las placas no exigen foto de bloque (se comportan como
        # formatos). Lectura defensiva del campo del módulo de pagos; si no existe
        # se trata como internacional. El resto de validaciones no cambia.
        po = access.purchase_id
        is_national = bool(
            po and "purchase_payment_scope" in po._fields
            and po.purchase_payment_scope == "national"
        )

        if not proforma.shipment_ids:
            return {
                "success": False,
                "message": "Debe existir al menos un embarque antes de completar la proforma.",
            }

        can_complete, msg = self.can_complete(proforma)
        if not can_complete:
            return {"success": False, "message": msg}

        # Naviera y forwarder son OBLIGATORIOS en embarques internacionales:
        # sin ellos no se puede seleccionar la tarifa correcta del tarifario.
        if not is_national:
            for shipment in proforma.shipment_ids:
                missing = []
                if not getattr(shipment, 'naviera_id', False):
                    missing.append('naviera')
                if not getattr(shipment, 'forwarder_id', False):
                    missing.append('forwarder')
                if missing:
                    return {
                        "success": False,
                        "message": "El embarque '%s' no tiene %s. Selecciónalo "
                                   "en la pestaña de Logística (catálogo del "
                                   "tarifario)." % (shipment.name, ' ni '.join(missing)),
                    }

        for shipment in proforma.shipment_ids:
            for packing in self.sorted_packings(shipment.packing_ids):
                if packing.scope == "specific_containers" and not packing.container_ids:
                    return {
                        "success": False,
                        "message": "Existe un packing con alcance a contenedores específicos pero sin contenedores asignados.",
                    }

                if packing.scope == "specific_containers":
                    invalid_rows = packing.row_ids.filtered(
                        lambda row: row.container_id and row.container_id.id not in packing.container_ids.ids
                    )
                    if invalid_rows:
                        return {
                            "success": False,
                            "message": "Existe un packing con filas usando contenedores fuera de su alcance.",
                        }

            # Compra nacional: no se exige fotografía por bloque. Usuario interno
            # con sesión activa: también puede saltarse la validación.
            if is_national or self.is_internal_user():
                continue
            block_image_model = request.env["supplier.shipment.block.image"].sudo()
            for packing in self.sorted_packings(shipment.packing_ids):
                blocks_in_packing = set()
                for row in packing.row_ids:
                    # La foto por bloque solo aplica a Placas. Formato/Pieza no
                    # tienen bloque de cantera, así que no se exige fotografía.
                    if (row.tipo or "").strip().lower() != "placa":
                        continue
                    block_name = (row.bloque or "").strip()
                    if block_name:
                        blocks_in_packing.add((block_name, row.product_id.id))

                for block_name, product_id in blocks_in_packing:
                    existing = block_image_model.search([
                        ("shipment_id", "=", shipment.id),
                        ("block_name", "=ilike", block_name),
                        ("product_id", "=", product_id),
                    ], limit=1)
                    if not existing:
                        return {
                            "success": False,
                            "message": 'El bloque "%s" en el embarque "%s" no tiene fotografía.' % (block_name, shipment.name),
                        }

        # La sobreasignación NO bloquea la finalización: el proveedor puede haber
        # embarcado de más a propósito. Solo se AVISA cuando el excedente supera el
        # 3% de lo solicitado (variaciones menores —p. ej. por corte de placas— son
        # normales y no se mencionan). Que asignado == solicitado nunca es aviso.
        OVER_THRESHOLD = 0.03
        balance = self._build_quantity_balance(proforma)
        over_items = []
        for item in balance:
            ordered = item.get("qty_ordered") or 0.0
            excess = item.get("qty_excess") or 0.0
            if ordered <= 0:
                continue
            if (excess / ordered) > OVER_THRESHOLD:
                over_items.append(item)

        proforma.write({"status": "complete", "portal_overall_pct": 100})
        self.sync_service.sync_all_shipments(proforma)

        # Al terminar el proveedor, el PL de CADA recepción se procesa en
        # automático (una recepción por PO en facturas de carga) — el mismo
        # efecto que el botón "Procesar PL", sin acción manual. Si alguna
        # falla, la finalización NO se revierte: el botón manual queda como
        # respaldo y se avisa en la respuesta.
        processed_pls, process_errors = self._auto_process_packing_lists(proforma)

        result = {"success": True}
        if processed_pls:
            result["processed_pl"] = processed_pls
        if process_errors:
            result["warning"] = (
                "La operación se finalizó, pero el procesamiento automático del "
                "PL falló en estas recepciones (procésalas con el botón "
                "'Procesar PL'):\n\n" + "\n".join(process_errors)
            )
        if over_items:
            detail_lines = []
            for item in over_items:
                ordered = item.get("qty_ordered") or 0.0
                excess = item.get("qty_excess") or 0.0
                pct = (excess / ordered * 100.0) if ordered else 0.0
                detail_lines.append(
                    '• %s: asignado %.3f %s vs. solicitado %.3f %s (excedente %.3f %s, +%.1f%%).' % (
                        item["product_name"],
                        item["qty_assigned"],
                        item["uom"],
                        item["qty_ordered"],
                        item["uom"],
                        item["qty_excess"],
                        item["uom"],
                        pct,
                    )
                )
            result["warning"] = (
                "La operación se finalizó correctamente. Aviso: hay sobreasignación "
                "mayor al 3% (embarcaste más de lo que pidió la OC) en estos productos:\n\n"
                + "\n".join(detail_lines)
            )
            result["over_items"] = over_items
        return result

    def _auto_process_packing_lists(self, proforma):
        """Procesa el PL de todas las recepciones de la proforma (equivalente
        programático del botón "Procesar PL"). Devuelve (procesadas, errores).

        Se salta recepciones ya procesadas, validadas, sin spreadsheet o sin
        material asignado (PO de la carga sin filas en este embarque)."""
        Wizard = request.env["packing.list.import.wizard"].sudo()
        pickings = request.env["stock.picking"].sudo()
        for shipment in proforma.shipment_ids:
            pickings |= self.sync_service._find_pickings_for_shipment(shipment)

        processed = []
        errors = []
        for picking in pickings:
            if picking.state in ("done", "cancel", "draft"):
                continue
            if picking.packing_list_imported or picking.worksheet_imported:
                continue
            if not picking.spreadsheet_id:
                continue
            has_demand = any(
                move.state not in ("done", "cancel")
                and (move.product_uom_qty or 0.0) > 0
                for move in picking.move_ids
            )
            if not has_demand:
                continue
            try:
                wizard = Wizard.create({"picking_id": picking.id})
                wizard.action_import_excel()
                processed.append(picking.name)
                _logger.info(
                    "[Portal] PL procesado automáticamente al completar la "
                    "proforma %s: recepción %s.", proforma.id, picking.name,
                )
            except Exception as exc:
                errors.append("%s: %s" % (picking.name, exc))
                _logger.exception(
                    "[Portal] Falló el auto-proceso del PL en la recepción %s.",
                    picking.name,
                )
        return processed, errors

    def save_progress(self, token, percent):
        """El portal reporta SU porcentaje de avance (status.overall). Odoo
        lo hereda tal cual: es el mismo número que ve el proveedor."""
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}
        proforma = self.get_or_create_proforma(access)
        if not proforma:
            return {"success": False, "message": "Proforma no encontrada."}
        pct = max(0, min(100, self.safe_int(percent, 0)))
        if proforma.portal_overall_pct != pct:
            proforma.write({"portal_overall_pct": pct})
        return {"success": True, "percent": pct}

    def reload_proforma(self, token):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        if not proforma:
            return {"success": False, "message": "Proforma no encontrada."}

        return {"success": True, "proforma": self.serialize_proforma(proforma)}

    # =====================================================================
    #  ROW IMAGES
    # =====================================================================

    def upload_row_image(self, token, row_id, image_data, image_name):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        row = request.env["supplier.shipment.packing.row"].sudo().browse(self.safe_int(row_id))
        if not row.exists():
            return {"success": False, "message": "Fila no encontrada."}

        if not self.belongs_to_proforma(proforma, row=row):
            return {"success": False, "message": "Fila no pertenece a esta proforma."}

        vals = {"image": image_data}
        if image_name:
            vals["image_filename"] = image_name

        row.write(vals)
        return {"success": True, "row_id": row.id}

    def delete_row_image(self, token, row_id):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        row = request.env["supplier.shipment.packing.row"].sudo().browse(self.safe_int(row_id))
        if not row.exists():
            return {"success": False, "message": "Fila no encontrada."}

        if not self.belongs_to_proforma(proforma, row=row):
            return {"success": False, "message": "Fila no pertenece a esta proforma."}

        row.write({"image": False, "image_filename": False})
        return {"success": True}

    # =====================================================================
    #  BLOCK IMAGES
    # =====================================================================

    def upload_block_image(self, token, shipment_id, block_name, product_id, image_data, image_name):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        shipment = request.env["supplier.shipment"].sudo().browse(self.safe_int(shipment_id))
        if not shipment.exists() or not self.belongs_to_proforma(proforma, shipment=shipment):
            return {"success": False, "message": "Embarque no encontrado o no autorizado."}

        if not block_name or not str(block_name).strip():
            return {"success": False, "message": "Nombre de bloque requerido."}

        if not image_data:
            return {"success": False, "message": "No se recibió imagen."}

        block_image_model = request.env["supplier.shipment.block.image"].sudo()
        clean_block = str(block_name).strip()
        clean_product = self.safe_int(product_id)

        # Validar producto: sin esto un product_id=0/inválido crea registros basura
        # o rompe la FK (error 500) y la foto "no se sube".
        if not clean_product or not request.env["product.product"].sudo().browse(clean_product).exists():
            return {"success": False, "message": "Producto del bloque inválido o no especificado."}

        # Upsert insensible a mayúsculas (el portal puede mandar otra capitalización):
        # evita duplicados y que la validación final no encuentre la foto.
        record = block_image_model.search([
            ("shipment_id", "=", shipment.id),
            ("block_name", "=ilike", clean_block),
            ("product_id", "=", clean_product),
        ], limit=1)
        values = {
            "image": image_data,
            "image_filename": image_name or "block_photo",
        }
        if record:
            record.write(values)
        else:
            record = block_image_model.create(dict(values, **{
                "shipment_id": shipment.id,
                "block_name": clean_block,
                "product_id": clean_product,
            }))
        return {"success": True, "block_image_id": record.id}

    def delete_block_image(self, token, block_image_id):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        record = request.env["supplier.shipment.block.image"].sudo().browse(self.safe_int(block_image_id))
        if not record.exists():
            return {"success": False, "message": "Registro no encontrado."}

        if not self.belongs_to_proforma(proforma, shipment=record.shipment_id):
            return {"success": False, "message": "No autorizado."}

        record.unlink()
        return {"success": True}

    def get_block_images(self, token, shipment_id):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        proforma = self.get_or_create_proforma(access)
        shipment = request.env["supplier.shipment"].sudo().browse(self.safe_int(shipment_id))
        if not shipment.exists() or not self.belongs_to_proforma(proforma, shipment=shipment):
            return {"success": False, "message": "Embarque no encontrado."}

        images = [{
            "id": image.id,
            "block_name": image.block_name,
            "product_id": image.product_id.id,
            "product_name": self.origin_name_for_partner(image.product_id, self.partner_from_shipment(shipment)),
            "image_filename": image.image_filename or "",
            "has_image": bool(image.image),
        } for image in shipment.block_image_ids]

        return {"success": True, "block_images": images}

    # =====================================================================
    #  LEGACY submit
    # =====================================================================

    def submit_legacy_pl_data(self, token, rows, header, files):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token inválido."}

        po = access.purchase_id
        if not po:
            return {"success": False, "message": "Orden de compra no encontrada."}

        return {
            "success": False,
            "message": "El flujo legacy submit ya no está permitido porque ahora cada embarque genera su propia recepción.",
        }
