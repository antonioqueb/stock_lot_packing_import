# -*- coding: utf-8 -*-

import logging

from .supplier_portal_base import SupplierPortalBaseService

_logger = logging.getLogger(__name__)


class SupplierPortalSyncService(SupplierPortalBaseService):
    """
    Sincronización de portal -> Odoo con nueva lógica:
    - 1 token por OC
    - 1 proforma general por OC
    - 1 recepción (stock.picking) por embarque
    """

    # =====================================================================
    #  HELPERS PICKING POR EMBARQUE
    # =====================================================================

    def _find_picking_for_shipment(self, shipment):
        return self.env["stock.picking"].sudo().search(
            [("supplier_shipment_id", "=", shipment.id)],
            order="id desc",
            limit=1,
        )

    @property
    def env(self):
        from odoo.http import request
        return request.env

    def _get_incoming_picking_type(self, po):
        picking_type = getattr(po, "picking_type_id", False)
        if picking_type and picking_type.code == "incoming":
            return picking_type

        company = po.company_id
        picking_type = self.env["stock.picking.type"].sudo().search([
            ("code", "=", "incoming"),
            ("warehouse_id.company_id", "=", company.id),
        ], limit=1)
        if picking_type:
            return picking_type

        picking_type = self.env["stock.picking.type"].sudo().search([
            ("code", "=", "incoming"),
            ("company_id", "=", company.id),
        ], limit=1)
        return picking_type

    def _get_unlinked_po_pickings(self, po):
        return po.picking_ids.filtered(
            lambda p: p.picking_type_code == "incoming"
            and p.state not in ("cancel",)
            and not p.supplier_shipment_id
        ).sorted(lambda p: p.id)

    def _prepare_picking_origin(self, po, shipment):
        shipment_name = shipment.name or ("EMB-%s" % shipment.id)
        return "%s / %s" % (po.name or "PO", shipment_name)

    def _prepare_move_vals_from_po_line(self, picking, po_line):
        return {
            "name": po_line.name or po_line.product_id.display_name,
            "product_id": po_line.product_id.id,
            "product_uom_qty": po_line.product_qty or 0.0,
            "product_uom": po_line.product_uom.id,
            "picking_id": picking.id,
            "location_id": picking.location_id.id,
            "location_dest_id": picking.location_dest_id.id,
            "company_id": picking.company_id.id,
            "partner_id": picking.partner_id.id if picking.partner_id else False,
            "purchase_line_id": po_line.id if "purchase_line_id" in self.env["stock.move"]._fields else False,
        }

    def _seed_moves_from_purchase(self, picking, po):
        move_model = self.env["stock.move"].sudo()
        existing_products = set(picking.move_ids.mapped("product_id").ids)

        for line in po.order_line.filtered(lambda l: not l.display_type and l.product_id):
            if line.product_id.id in existing_products:
                continue
            vals = self._prepare_move_vals_from_po_line(picking, line)
            move_model.create(vals)

    def get_or_create_picking_for_shipment(self, shipment):
        picking = self._find_picking_for_shipment(shipment)
        if picking:
            return picking

        po = shipment.proforma_id.purchase_id
        if not po:
            return False

        unlinked_po_pickings = self._get_unlinked_po_pickings(po)

        # Reutilizar la primera recepción incoming estándar no ligada aún.
        if unlinked_po_pickings:
            picking = unlinked_po_pickings[0]
            picking.sudo().write({
                "supplier_shipment_id": shipment.id,
                "origin": self._prepare_picking_origin(po, shipment),
            })
            return picking

        picking_type = self._get_incoming_picking_type(po)
        if not picking_type:
            _logger.error("[Portal] No se encontró tipo de operación incoming para PO %s.", po.name)
            return False

        vals = {
            "picking_type_id": picking_type.id,
            "partner_id": po.partner_id.id,
            "company_id": po.company_id.id,
            "origin": self._prepare_picking_origin(po, shipment),
            "location_id": picking_type.default_location_src_id.id,
            "location_dest_id": picking_type.default_location_dest_id.id,
            "supplier_shipment_id": shipment.id,
        }

        if "move_type" in self.env["stock.picking"]._fields:
            vals["move_type"] = po.picking_ids[:1].move_type if po.picking_ids else "direct"

        picking = self.env["stock.picking"].sudo().create(vals)
        self._seed_moves_from_purchase(picking, po)
        return picking

    # =====================================================================
    #  SYNC CABECERA DEL EMBARQUE -> PICKING
    # =====================================================================

    def sync_shipment_header_to_picking(self, shipment):
        picking = self.get_or_create_picking_for_shipment(shipment)
        if not picking:
            return False

        header = shipment.proforma_id
        container_numbers = list(dict.fromkeys([x for x in shipment.container_ids.mapped("container_number") if x]))
        seal_numbers = list(dict.fromkeys([x for x in shipment.container_ids.mapped("seal_number") if x]))
        container_types = list(dict.fromkeys([x for x in shipment.container_ids.mapped("container_type") if x]))

        vals = {
            "origin": self._prepare_picking_origin(header.purchase_id, shipment),
            "supplier_proforma_number": header.proforma_number or "",
            "supplier_invoice_number": header.invoice_global_number or "",
            "supplier_payment_terms": header.payment_terms or "",
            "supplier_country_origin": header.country_origin or "",
            "supplier_incoterm_payment": header.incoterm or "",
            "supplier_merchandise_desc": header.general_notes or "",
            "supplier_shipment_date": shipment.etd or False,
            "supplier_bl_number": shipment.bl_number or "",
            "supplier_origin": shipment.port_origin or "",
            "supplier_destination": shipment.port_destination or "",
            "supplier_vessel": shipment.vessel_name or "",
            "supplier_container_no": ", ".join(container_numbers) if container_numbers else "",
            "supplier_seal_no": ", ".join(seal_numbers) if seal_numbers else "",
            "supplier_container_type": ", ".join(container_types) if container_types else "",
            "supplier_total_packages": int(sum(shipment.container_ids.mapped("packages")) or 0),
            "supplier_gross_weight": float(sum(shipment.container_ids.mapped("weight")) or 0.0),
            "supplier_volume": float(sum(shipment.container_ids.mapped("volume")) or 0.0),
            "supplier_status": shipment.status or "",
        }

        try:
            picking.sudo().write(vals)
            return picking
        except Exception:
            _logger.exception(
                "[Portal] Error sincronizando cabecera de shipment %s al picking %s.",
                shipment.id, picking.id,
            )
            return False

    # =====================================================================
    #  SYNC FILAS DEL EMBARQUE -> SPREADSHEET DEL PICKING
    # =====================================================================

    def sync_shipment_rows_to_spreadsheet(self, shipment):
        picking = self.get_or_create_picking_for_shipment(shipment)
        if not picking:
            return False

        header = shipment.proforma_id
        rows = []

        for packing in self.sorted_packings(shipment.packing_ids):
            packing_container_ids = packing.container_ids.ids
            packing_container_numbers = packing.container_ids.mapped("container_number")

            for row in packing.row_ids.sorted("sequence"):
                container_name = ""
                if row.container_id and row.container_id.container_number:
                    container_name = row.container_id.container_number
                elif packing.scope == "specific_containers" and len(packing_container_numbers) == 1:
                    container_name = packing_container_numbers[0] or ""
                elif packing.scope == "specific_containers" and len(packing_container_numbers) > 1:
                    container_name = "MULTI"
                else:
                    container_name = "SN"

                rows.append({
                    "product_id": row.product_id.id,
                    "grosor": row.grosor or "",
                    "alto": row.alto or 0,
                    "ancho": row.ancho or 0,
                    "peso": row.peso or 0,
                    "quantity": row.quantity or 0,
                    "color": row.color or "",
                    "bloque": row.bloque or "",
                    "numero_placa": row.numero_placa or "",
                    "atado": row.atado or "",
                    "tipo": row.tipo or "Placa",
                    "grupo_name": row.grupo_name or "",
                    "pedimento": row.pedimento or "",
                    "contenedor": container_name or "SN",
                    "ref_proveedor": row.ref_proveedor or "",
                    "packing_id": packing.id,
                    "packing_scope": packing.scope or "full_shipment",
                    "packing_container_ids": packing_container_ids,
                })

        header_data = {
            "proforma_number": header.proforma_number or "",
            "invoice_number": header.invoice_global_number or "",
            "payment_terms": header.payment_terms or "",
            "country_origin": header.country_origin or "",
            "origin": shipment.port_origin or "",
            "destination": shipment.port_destination or "",
            "incoterm": header.incoterm or "",
            "bl_number": shipment.bl_number or "",
            "shipment_date": str(shipment.etd) if shipment.etd else "",
            "vessel": shipment.vessel_name or "",
            "merchandise_desc": header.general_notes or "",
            "container_no": ", ".join([x for x in shipment.container_ids.mapped("container_number") if x]),
            "seal_no": ", ".join([x for x in shipment.container_ids.mapped("seal_number") if x]),
            "container_type": ", ".join([x for x in shipment.container_ids.mapped("container_type") if x]),
            "total_packages": int(sum(shipment.container_ids.mapped("packages")) or 0),
            "gross_weight": float(sum(shipment.container_ids.mapped("weight")) or 0.0),
            "volume": float(sum(shipment.container_ids.mapped("volume")) or 0.0),
            "status": shipment.status or "",
        }

        try:
            picking.sudo().update_packing_list_from_portal(rows, header_data=header_data)
            return True
        except Exception:
            _logger.exception(
                "[Portal] Error sincronizando filas del shipment %s al spreadsheet del picking %s.",
                shipment.id, picking.id,
            )
            return False

    # =====================================================================
    #  SYNC COMPLETO
    # =====================================================================

    def sync_shipment(self, shipment):
        picking = self.sync_shipment_header_to_picking(shipment)
        if not picking:
            return False
        self.sync_shipment_rows_to_spreadsheet(shipment)
        return picking

    def sync_all_shipments(self, proforma):
        for shipment in self.sorted_shipments(proforma.shipment_ids):
            self.sync_shipment(shipment)

    # =====================================================================
    #  DELETE / UNLINK PICKING DE EMBARQUE
    # =====================================================================

    def delete_picking_for_shipment(self, shipment):
        picking = self._find_picking_for_shipment(shipment)
        if not picking:
            return True

        if picking.state == "done":
            return False

        try:
            if picking.state not in ("draft", "cancel"):
                try:
                    picking.sudo().action_cancel()
                except Exception:
                    _logger.warning(
                        "[Portal] No se pudo cancelar picking %s antes de eliminar. Se intenta unlink directo.",
                        picking.id,
                    )

            picking.sudo().unlink()
            return True
        except Exception:
            _logger.exception(
                "[Portal] No se pudo eliminar picking %s ligado al shipment %s.",
                picking.id, shipment.id,
            )
            return False