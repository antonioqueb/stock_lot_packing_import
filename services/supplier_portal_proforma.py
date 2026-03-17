# -*- coding: utf-8 -*-

import json
import logging

from markupsafe import Markup
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

    def validate_container_ids_for_shipment(self, shipment, container_ids):
        normalized = self.normalize_id_list(container_ids)
        shipment_container_ids = set(shipment.container_ids.ids)
        invalid = [cid for cid in normalized if cid not in shipment_container_ids]
        if invalid:
            return False, "Uno o más contenedores no pertenecen al embarque actual."
        return True, normalized

    def validate_packing_scope_and_containers(self, shipment, packing_vals, rows=None):
        scope = packing_vals.get("scope") or "full_shipment"
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
    #  PROGRESO Y COMPLETITUD
    # =====================================================================

    def compute_progress(self, proforma):
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
        all_docs = doc_model.search([
            ("shipment_id", "in", proforma.shipment_ids.ids),
        ])

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

        doc_model = request.env["supplier.shipment.document"].sudo()
        required_per_shipment = ["bl", "invoice", "packing_list"]

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

    def _get_shipment_picking(self, shipment):
        return request.env["stock.picking"].sudo().search(
            [("supplier_shipment_id", "=", shipment.id)],
            order="id desc",
            limit=1,
        )

    def serialize_proforma(self, header):
        shipments = []

        for shipment in self.sorted_shipments(header.shipment_ids):
            picking = self._get_shipment_picking(shipment)

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

            packings = []
            for packing in self.sorted_packings(shipment.packing_ids):
                derived = self.compute_packing_derived_flags(packing)

                rows_payload = []
                for row in packing.row_ids.sorted("sequence"):
                    rows_payload.append({
                        "id": row.id,
                        "product_id": row.product_id.id,
                        "product_name": row.product_id.display_name,
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
                    })

                packings.append({
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
                })

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
                    "product_name": image.product_id.display_name,
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
            })

        progress = self.compute_progress(header)

        return {
            "id": header.id,
            "proforma_number": header.proforma_number or "",
            "invoice_global_number": header.invoice_global_number or "",
            "payment_terms": header.payment_terms or "",
            "country_origin": header.country_origin or "",
            "incoterm": header.incoterm or "",
            "general_notes": header.general_notes or "",
            "status": header.status or "draft",
            "shipments": shipments,
            "global_documents": [],
            "progress": progress,
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

        products = self.build_products_payload_from_purchase(po)
        proforma = self.get_or_create_proforma(access)
        proforma_data = self.serialize_proforma(proforma) if proforma else {}

        full_data = {
            "products": products,
            "existing_rows": [],
            "header": {
                "proforma_number": proforma.proforma_number or "" if proforma else "",
                "invoice_number": proforma.invoice_global_number or "" if proforma else "",
                "payment_terms": proforma.payment_terms or "" if proforma else "",
                "country_origin": proforma.country_origin or "" if proforma else "",
                "incoterm": proforma.incoterm or "" if proforma else "",
                "general_notes": proforma.general_notes or "" if proforma else "",
            },
            "proforma": proforma_data,
            "token": token,
            "poName": po.name or "",
            "pickingName": "",
            "vendor_name": po.partner_id.name or "",
            "companyName": po.company_id.name or "",
            "apiVersion": 2,
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
            "incoterm": "incoterm",
            "general_notes": "general_notes",
        }

        if globals_data:
            for js_key, py_field in field_map.items():
                if js_key in globals_data:
                    vals[py_field] = globals_data[js_key] or ""

        if vals:
            proforma.write(vals)

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
        return {"success": True, "container_ids": list(existing_ids)}

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

        for invoice in (invoices or []):
            invoice_id = self.safe_int(invoice.get("id"), 0)
            scope = invoice.get("scope", "full_shipment")
            container_ids = self.normalize_id_list(invoice.get("container_ids", []))

            ok, result = self.validate_container_ids_for_shipment(shipment, container_ids)
            if not ok:
                return {"success": False, "message": result}

            if scope == "specific_containers" and not result:
                return {
                    "success": False,
                    "message": "Si el invoice aplica a contenedores específicos, debe seleccionar al menos un contenedor.",
                }

            vals = {
                "invoice_number": invoice.get("invoice_number", ""),
                "invoice_date": invoice.get("invoice_date") or False,
                "amount": self.safe_float(invoice.get("amount", 0)),
                "scope": scope,
                "container_ids": [(6, 0, result)],
            }

            if invoice.get("currency_id"):
                vals["currency_id"] = self.safe_int(invoice["currency_id"])

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

        return {"success": True, "invoice_ids": list(existing_ids)}

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
        scope = packing_data.get("scope", "full_shipment")
        raw_container_ids = packing_data.get("container_ids", [])

        packing_vals = {
            "packing_number": packing_data.get("packing_number", ""),
            "packing_date": packing_data.get("packing_date") or False,
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
            "packing_number": packing_data.get("packing_number", ""),
            "packing_date": packing_data.get("packing_date") or False,
            "scope": scope,
            "container_ids": [(6, 0, normalized_container_ids)],
        }

        if packing_id:
            packing = packing_model.browse(packing_id)
            if not packing.exists() or not self.belongs_to_proforma(proforma, packing=packing):
                return {"success": False, "message": "Packing no encontrado o no autorizado."}
            packing.write(vals)
        else:
            vals["shipment_id"] = shipment.id
            packing = packing_model.create(vals)

        if rows is not None:
            existing_rows = {row.id: row for row in packing.row_ids}
            incoming_ids = set()
            sequence = 10

            shipment_container_ids = set(shipment.container_ids.ids)
            packing_container_ids = set(normalized_container_ids)

            for idx, row in enumerate(rows, start=1):
                row_id = self.safe_int(row.get("id"), 0)
                row_container_id = self.safe_int(row.get("container_id"), 0)

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

                if not row_vals["product_id"]:
                    return {"success": False, "message": "Todas las filas deben tener producto."}

                if row_id:
                    row_record = existing_rows.get(row_id)
                    if not row_record:
                        return {"success": False, "message": "Una de las filas no pertenece al packing actual."}
                    row_record.write(row_vals)
                    incoming_ids.add(row_record.id)
                else:
                    new_row = row_model.create(row_vals)
                    incoming_ids.add(new_row.id)

                sequence += 10

            rows_to_delete = packing.row_ids.filtered(lambda rec: rec.id not in incoming_ids)
            if rows_to_delete:
                rows_to_delete.unlink()

        if rows is not None:
            valid_rows = [row for row in (rows or []) if row]
            if valid_rows:
                blocks_in_rows = set()
                for row in valid_rows:
                    block_name = (row.get("bloque") or "").strip()
                    if block_name:
                        blocks_in_rows.add((block_name, self.safe_int(row.get("product_id", 0))))

                if blocks_in_rows:
                    block_image_model = request.env["supplier.shipment.block.image"].sudo()
                    for block_name, product_id in blocks_in_rows:
                        existing = block_image_model.search([
                            ("shipment_id", "=", shipment.id),
                            ("block_name", "=", block_name),
                            ("product_id", "=", product_id),
                        ], limit=1)
                        if not existing:
                            return {
                                "success": False,
                                "message": 'El bloque "%s" no tiene fotografía. Suba al menos una foto por bloque antes de guardar.' % block_name,
                            }

        self.sync_service.sync_shipment(shipment)
        return {"success": True, "packing_id": packing.id}

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

        if not proforma.shipment_ids:
            return {
                "success": False,
                "message": "Debe existir al menos un embarque antes de completar la proforma.",
            }

        can_complete, msg = self.can_complete(proforma)
        if not can_complete:
            return {"success": False, "message": msg}

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

            block_image_model = request.env["supplier.shipment.block.image"].sudo()
            for packing in self.sorted_packings(shipment.packing_ids):
                blocks_in_packing = set()
                for row in packing.row_ids:
                    block_name = (row.bloque or "").strip()
                    if block_name:
                        blocks_in_packing.add((block_name, row.product_id.id))

                for block_name, product_id in blocks_in_packing:
                    existing = block_image_model.search([
                        ("shipment_id", "=", shipment.id),
                        ("block_name", "=", block_name),
                        ("product_id", "=", product_id),
                    ], limit=1)
                    if not existing:
                        return {
                            "success": False,
                            "message": 'El bloque "%s" en el embarque "%s" no tiene fotografía.' % (block_name, shipment.name),
                        }

        proforma.write({"status": "complete"})
        self.sync_service.sync_all_shipments(proforma)
        return {"success": True}

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

        record = request.env["supplier.shipment.block.image"].sudo().create({
            "shipment_id": shipment.id,
            "block_name": str(block_name).strip(),
            "product_id": self.safe_int(product_id),
            "image": image_data,
            "image_filename": image_name or "block_photo",
        })
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
            "product_name": image.product_id.display_name,
            "image_filename": image.image_filename or "",
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

        # Legacy ya no debe aterrizar contra una recepción global.
        # Se deja bloqueado explícitamente para no mezclar datos de múltiples embarques.
        return {
            "success": False,
            "message": "El flujo legacy submit ya no está permitido porque ahora cada embarque genera su propia recepción.",
        }