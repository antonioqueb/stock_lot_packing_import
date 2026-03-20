# -*- coding: utf-8 -*-

import logging

from .supplier_portal_base import SupplierPortalBaseService

_logger = logging.getLogger(__name__)


class SupplierPortalSyncService(SupplierPortalBaseService):
    """
    Sincronización de portal -> Odoo con lógica corregida:
    - 1 token por OC
    - 1 proforma general por OC
    - 1 recepción (stock.picking) por embarque
    - cada picking usa cantidades del embarque actual o, si aún no hay captura,
      el remanente disponible contra otros embarques
    """

    @property
    def env(self):
        from odoo.http import request
        return request.env

    # =====================================================================
    #  HELPERS BASE
    # =====================================================================

    def _find_picking_for_shipment(self, shipment):
        return self.env["stock.picking"].sudo().search(
            [("supplier_shipment_id", "=", shipment.id)],
            order="id desc",
            limit=1,
        )

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

    # =====================================================================
    #  CÁLCULO DE CANTIDADES
    # =====================================================================

    def _row_effective_qty(self, row):
        """
        Cantidad efectiva de una fila del packing:
        - Placa: alto * ancho
        - Pieza / Formato: quantity
        """
        tipo = (row.tipo or "Placa").strip().lower()
        if tipo == "placa":
            return round((row.alto or 0.0) * (row.ancho or 0.0), 6)
        return row.quantity or 0.0

    def _po_ordered_qty_map(self, po):
        """
        Cantidad maestra pedida por producto.
        Si existe x_qty_solicitada_original, esa manda.
        """
        result = {}
        for line in po.order_line.filtered(lambda l: not l.display_type and l.product_id):
            base_qty = line.x_qty_solicitada_original or line.product_qty or 0.0
            pid = line.product_id.id
            result[pid] = result.get(pid, 0.0) + base_qty
        return result

    def _shipment_qty_map(self, shipment):
        """
        Cantidad capturada actualmente en el shipment, basada en packings/rows.
        """
        result = {}
        for packing in shipment.packing_ids:
            for row in packing.row_ids:
                pid = row.product_id.id
                qty = self._row_effective_qty(row)
                result[pid] = result.get(pid, 0.0) + qty
        return result

    def _other_shipments_qty_map(self, shipment):
        """
        Cantidad ya asignada/capturada en otros embarques de la misma proforma.
        """
        result = {}
        proforma = shipment.proforma_id
        for other in proforma.shipment_ids.filtered(lambda s: s.id != shipment.id):
            other_map = self._shipment_qty_map(other)
            for pid, qty in other_map.items():
                result[pid] = result.get(pid, 0.0) + qty
        return result

    def _remaining_qty_map_for_shipment(self, shipment):
        """
        Remanente disponible para este shipment:
        solicitado original - ya capturado en otros shipments
        """
        po = shipment.proforma_id.purchase_id
        ordered = self._po_ordered_qty_map(po)
        assigned_other = self._other_shipments_qty_map(shipment)

        result = {}
        for pid, qty_ordered in ordered.items():
            result[pid] = qty_ordered - assigned_other.get(pid, 0.0)
        return result

    def build_products_payload_for_shipment(self, shipment):
        """
        Payload detallado por shipment para el portal:
        - qty_ordered: total pedido en OC
        - qty_assigned_other: ya capturado en otros embarques
        - qty_current_shipment: lo que lleva este embarque
        - qty_available: remanente disponible para este embarque
        - qty_remaining_after: remanente después de lo capturado en este embarque
        """
        po = shipment.proforma_id.purchase_id
        ordered = self._po_ordered_qty_map(po)
        other = self._other_shipments_qty_map(shipment)
        current = self._shipment_qty_map(shipment)

        product_line_map = {}
        for line in po.order_line.filtered(lambda l: not l.display_type and l.product_id):
            if line.product_id.id not in product_line_map:
                product_line_map[line.product_id.id] = line

        products = []
        for pid, line in product_line_map.items():
            qty_ordered = ordered.get(pid, 0.0)
            qty_other = other.get(pid, 0.0)
            qty_current = current.get(pid, 0.0)
            qty_available = qty_ordered - qty_other
            qty_remaining_after = qty_ordered - qty_other - qty_current
            qty_over_assigned = max(0.0, -qty_remaining_after)

            product = line.product_id
            unit_type = product.product_tmpl_id.x_unidad_del_producto or "Placa"

            products.append({
                "id": product.id,
                "name": product.display_name or product.name,
                "code": product.default_code or "",
                "uom": line.product_uom_id.name or "",
                "unit_type": unit_type,
                "qty_ordered": qty_ordered,
                "qty_assigned_other": qty_other,
                "qty_current_shipment": qty_current,
                "qty_available": qty_available,
                "qty_remaining_after": qty_remaining_after,
                "qty_over_assigned": qty_over_assigned,
                "is_over_assigned": bool(qty_over_assigned > 0.000001),
            })

        products.sort(key=lambda item: (item.get("name") or "").lower())
        return products

    # =====================================================================
    #  MOVES DEL PICKING
    # =====================================================================

    def _prepare_move_vals_from_po_line(self, picking, po_line, qty):
        vals = {
            "product_id": po_line.product_id.id,
            "product_uom_qty": qty or 0.0,
            "product_uom": po_line.product_uom_id.id,
            "picking_id": picking.id,
            "location_id": picking.location_id.id,
            "location_dest_id": picking.location_dest_id.id,
            "company_id": picking.company_id.id,
            "partner_id": picking.partner_id.id if picking.partner_id else False,
        }

        if "purchase_line_id" in self.env["stock.move"]._fields:
            vals["purchase_line_id"] = po_line.id

        return vals

    def _cleanup_zero_move(self, move):
        """
        Si un move queda en 0:
        - si no tiene move lines, se intenta cancelar/unlink
        - si ya tiene move lines, solo se pone en 0
        """
        if move.state in ("done", "cancel"):
            return

        try:
            if move.move_line_ids:
                move.sudo().write({"product_uom_qty": 0.0})
                return
        except Exception:
            pass

        try:
            if hasattr(move, "_action_cancel"):
                move.sudo()._action_cancel()
        except Exception:
            pass

        try:
            move.sudo().unlink()
        except Exception:
            try:
                move.sudo().write({"product_uom_qty": 0.0})
            except Exception:
                _logger.warning(
                    "[Portal] No se pudo limpiar move %s en picking %s.",
                    move.id, move.picking_id.id
                )

    def _sync_picking_moves_from_shipment(self, shipment):
        """
        Sincroniza el picking del shipment:
        - si el shipment ya tiene rows, usa esas cantidades
        - si aún no tiene rows, usa el remanente disponible
        """
        picking = self._find_picking_for_shipment(shipment)
        if not picking:
            return False

        if picking.state == "done":
            return picking

        po = shipment.proforma_id.purchase_id
        if not po:
            return picking

        ordered_qty_map = self._po_ordered_qty_map(po)
        current_qty_map = self._shipment_qty_map(shipment)
        remaining_qty_map = self._remaining_qty_map_for_shipment(shipment)

        has_current_rows = any(qty > 0 for qty in current_qty_map.values())
        target_qty_map = current_qty_map if has_current_rows else remaining_qty_map

        # Un producto por shipment a nivel operativo
        product_line_map = {}
        for po_line in po.order_line.filtered(lambda l: not l.display_type and l.product_id):
            if po_line.product_id.id not in product_line_map:
                product_line_map[po_line.product_id.id] = po_line

        existing_moves = {}
        for move in picking.move_ids.filtered(lambda m: m.state != "cancel" and m.product_id):
            existing_moves[move.product_id.id] = move

        valid_product_ids = set(product_line_map.keys())

        for pid, po_line in product_line_map.items():
            ordered_qty = ordered_qty_map.get(pid, 0.0)
            target_qty = max(0.0, min(target_qty_map.get(pid, 0.0), ordered_qty))

            existing_move = existing_moves.get(pid)

            if target_qty > 0:
                if existing_move:
                    if existing_move.state != "done":
                        vals = {
                            "product_uom_qty": target_qty,
                            "product_uom": po_line.product_uom_id.id,
                        }
                        if "purchase_line_id" in existing_move._fields:
                            vals["purchase_line_id"] = po_line.id
                        existing_move.sudo().write(vals)
                else:
                    vals = self._prepare_move_vals_from_po_line(picking, po_line, target_qty)
                    self.env["stock.move"].sudo().create(vals)
            else:
                if existing_move:
                    self._cleanup_zero_move(existing_move)

        # Limpiar moves sobrantes que no pertenecen ya a la OC agrupada
        for move in picking.move_ids.filtered(lambda m: m.state != "done" and m.state != "cancel"):
            if move.product_id.id not in valid_product_ids:
                self._cleanup_zero_move(move)

        return picking

    # =====================================================================
    #  PICKING POR SHIPMENT
    # =====================================================================

    def get_or_create_picking_for_shipment(self, shipment):
        picking = self._find_picking_for_shipment(shipment)
        if picking:
            self._sync_picking_moves_from_shipment(shipment)
            return picking

        po = shipment.proforma_id.purchase_id
        if not po:
            return False

        unlinked_po_pickings = self._get_unlinked_po_pickings(po)

        if unlinked_po_pickings:
            picking = unlinked_po_pickings[0]
            picking.sudo().write({
                "supplier_shipment_id": shipment.id,
                "origin": self._prepare_picking_origin(po, shipment),
            })
            self._sync_picking_moves_from_shipment(shipment)
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
        self._sync_picking_moves_from_shipment(shipment)
        return picking

    # =====================================================================
    #  CABECERA / SPREADSHEET
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

    def sync_shipment(self, shipment):
        picking = self.sync_shipment_header_to_picking(shipment)
        if not picking:
            return False

        self._sync_picking_moves_from_shipment(shipment)
        self.sync_shipment_rows_to_spreadsheet(shipment)
        return picking

    def sync_all_shipments(self, proforma):
        for shipment in self.sorted_shipments(proforma.shipment_ids):
            self.sync_shipment(shipment)

    # =====================================================================
    #  ELIMINACIÓN
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