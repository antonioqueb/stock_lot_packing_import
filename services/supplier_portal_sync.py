# -*- coding: utf-8 -*-

import logging

from odoo import fields

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
            order="id asc",
            limit=1,
        )

    def _find_pickings_for_shipment(self, shipment):
        """TODAS las recepciones del embarque (una por PO en cargas)."""
        return self.env["stock.picking"].sudo().search(
            [("supplier_shipment_id", "=", shipment.id)], order="id asc")

    def _find_picking_for_shipment_po(self, shipment, po, is_main=False):
        """Recepción de UNA PO dentro del embarque. El picking legado (sin
        supplier_cargo_po_id, flujo clásico) lo adopta la PO principal."""
        picks = self._find_pickings_for_shipment(shipment)
        exact = picks.filtered(lambda pk: pk.supplier_cargo_po_id.id == po.id)
        if exact:
            return exact[0]
        if is_main:
            legacy = picks.filtered(lambda pk: not pk.supplier_cargo_po_id)
            if legacy:
                legacy[0].sudo().write({"supplier_cargo_po_id": po.id})
                return legacy[0]
        return self.env["stock.picking"].sudo()

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

    def _covered_pos_for_shipment(self, shipment):
        """POs que amparan a este embarque.

        Con factura de carga: TODAS las PO de la carga (el embarque puede
        mezclar material de varias PI). Sin carga: la PO de la proforma
        (flujo clásico, intacto).
        """
        proforma = shipment.proforma_id
        access = proforma.access_id if proforma else False
        if access and access.cargo_invoice_id and access.cargo_invoice_id.purchase_ids:
            return access.cargo_invoice_id.purchase_ids
        return proforma.purchase_id if proforma else self.env['purchase.order']

    def _pos_ordered_qty_map(self, pos):
        """Agregado por producto de VARIAS POs (respeta cantidad original)."""
        result = {}
        for po in pos:
            for pid, qty in self._po_ordered_qty_map(po).items():
                result[pid] = result.get(pid, 0.0) + qty
        return result

    def _pos_shipped_qty_map(self, pos, exclude_shipment=None):
        """Embarcado ACUMULADO por producto en TODOS los embarques de todas
        las proformas de esas POs (todas las cargas históricas). Es la base
        del saldo pendiente global de la PI/PO (punto 10 del flujo)."""
        result = {}
        headers = self.env['supplier.proforma.header'].sudo().search([
            ('purchase_id', 'in', pos.ids),
        ])
        for header in headers:
            for shipment in header.shipment_ids:
                if exclude_shipment and shipment.id == exclude_shipment.id:
                    continue
                for pid, qty in self._shipment_qty_map(shipment).items():
                    result[pid] = result.get(pid, 0.0) + qty
        return result

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

    def _row_po_id(self, row, default_po_id=0, allowed_ids=None):
        """PO a la que pertenece una fila del PL: su línea de compra, si no
        su PI elegida, si no la PO principal del embarque."""
        po_id = 0
        if row.purchase_line_id:
            po_id = row.purchase_line_id.order_id.id
        elif row.pi_header_id and row.pi_header_id.purchase_id:
            po_id = row.pi_header_id.purchase_id.id
        if allowed_ids is not None and po_id and po_id not in allowed_ids:
            po_id = 0
        return po_id or default_po_id

    def _shipment_qty_map_by_po(self, shipment):
        """{po_id: {product_id: qty}} de lo capturado en este embarque,
        repartido según la PI/línea de compra asignada a cada fila."""
        pos = self._covered_pos_for_shipment(shipment)
        default_po_id = pos[:1].id if pos else 0
        allowed = set(pos.ids)
        result = {}
        for packing in shipment.packing_ids:
            for row in packing.row_ids:
                po_id = self._row_po_id(row, default_po_id, allowed)
                if not po_id:
                    continue
                bucket = result.setdefault(po_id, {})
                pid = row.product_id.id
                bucket[pid] = bucket.get(pid, 0.0) + self._row_effective_qty(row)
        return result

    def _remaining_qty_map_for_po(self, shipment, po):
        """Remanente de UNA PO: su solicitud original menos lo ya asignado a
        sus líneas en cualquier OTRO embarque (filas trazadas)."""
        ordered = self._po_ordered_qty_map(po)
        shipped_other = {}
        rows = self.env['supplier.shipment.packing.row'].sudo().search([
            ('purchase_line_id.order_id', '=', po.id),
        ])
        for row in rows:
            if row.packing_id.shipment_id.id == shipment.id:
                continue
            pid = row.product_id.id
            shipped_other[pid] = (
                shipped_other.get(pid, 0.0) + self._row_effective_qty(row))
        return {
            pid: qty - shipped_other.get(pid, 0.0)
            for pid, qty in ordered.items()
        }

    def _remaining_qty_map_for_shipment(self, shipment):
        """
        Remanente disponible para este shipment:
        solicitado original (todas las POs de la carga) menos lo YA capturado
        en cualquier embarque de cualquier carga (saldo global de la PI/PO).
        """
        pos = self._covered_pos_for_shipment(shipment)
        ordered = self._pos_ordered_qty_map(pos)
        assigned_other = self._pos_shipped_qty_map(pos, exclude_shipment=shipment)

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
        pos = self._covered_pos_for_shipment(shipment)
        ordered = self._pos_ordered_qty_map(pos)
        # Saldo GLOBAL: lo capturado en cualquier embarque de cualquier carga.
        other = self._pos_shipped_qty_map(pos, exclude_shipment=shipment)
        current = self._shipment_qty_map(shipment)

        product_line_map = {}
        pi_refs_by_product = {}
        for po in pos:
            for line in po.order_line.filtered(lambda l: not l.display_type and l.product_id):
                if self._is_service_product(line.product_id):
                    continue
                pid = line.product_id.id
                if pid not in product_line_map:
                    product_line_map[pid] = line
                ref = po.partner_ref and ('PI %s' % po.partner_ref) or po.name
                pi_refs_by_product.setdefault(pid, [])
                if ref not in pi_refs_by_product[pid]:
                    pi_refs_by_product[pid].append(ref)

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
                "name": self.portal_product_name(line),
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
                # Trazabilidad PI/PO visible en el portal.
                "pi_refs": ' · '.join(pi_refs_by_product.get(pid, [])),
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
        """Cuando un producto queda sin cantidad capturada NO se elimina del
        picking: únicamente se pone su demanda en 0.

        Antes, si el proveedor omitía un producto en el packing, su move se
        cancelaba/eliminaba y el producto desaparecía por completo de la orden
        de recepción, sin forma de volver a agregarlo. Ahora se conserva (en 0)
        para que siga disponible y se pueda capturar después o al rehacer el PL.
        """
        if move.state in ("done", "cancel"):
            return

        try:
            move.sudo().write({"product_uom_qty": 0.0})
        except Exception:
            _logger.warning(
                "[Portal] No se pudo poner en 0 el move %s en picking %s.",
                move.id, move.picking_id.id
            )

    def _sync_picking_moves_from_shipment(self, shipment):
        """UNA recepción POR PO (punto clave de la factura de carga): lo
        capturado en el PL se reparte entre las recepciones según la PI/línea
        asignada a cada fila. Sin filas todavía, cada recepción nace con el
        remanente de SU propia PO. Con una sola PO es el flujo clásico."""
        pos = self._covered_pos_for_shipment(shipment)
        if not pos:
            return self._find_picking_for_shipment(shipment) or False

        by_po = self._shipment_qty_map_by_po(shipment)
        has_rows = any(
            qty > 0 for bucket in by_po.values() for qty in bucket.values())

        main_picking = False
        for index, po in enumerate(pos):
            picking = self._ensure_po_picking(shipment, po, is_main=(index == 0))
            if not picking:
                continue
            if index == 0:
                main_picking = picking
            target = (
                by_po.get(po.id, {}) if has_rows
                else self._remaining_qty_map_for_po(shipment, po)
            )
            self._sync_picking_moves_for_po(shipment, po, picking, target)
        return main_picking or self._find_picking_for_shipment(shipment)

    def _sync_picking_moves_for_po(self, shipment, po, picking, target_qty_map):
        """Moves de la recepción de UNA PO: un move por producto con la
        cantidad que le tocó a esa orden (capado a su pedido)."""
        if not picking or picking.state == "done":
            return picking

        ordered_qty_map = self._po_ordered_qty_map(po)

        product_line_map = {}
        for po_line in po.order_line.filtered(lambda l: not l.display_type and l.product_id):
            if po_line.product_id.id not in product_line_map:
                product_line_map[po_line.product_id.id] = po_line

        # UNA línea por producto en la recepción. Si la OC tiene el mismo
        # producto en varias líneas (precios distintos), el picking nativo nace
        # con un move por línea: se conserva UNO (que recibe la cantidad TOTAL
        # agregada del producto) y los duplicados se cancelan. El costo por
        # línea vive en la OC; la recepción opera el producto completo.
        existing_moves = {}
        duplicate_moves = self.env["stock.move"].sudo()
        for move in picking.move_ids.filtered(lambda m: m.state != "cancel" and m.product_id):
            pid = move.product_id.id
            if pid in existing_moves:
                duplicate_moves |= move
            else:
                existing_moves[pid] = move

        if duplicate_moves:
            pending_dups = duplicate_moves.filtered(lambda m: m.state != "done")
            if pending_dups:
                _logger.info(
                    "[Portal] Recepción %s: consolidando %s move(s) duplicados "
                    "del mismo producto (OC con varias líneas por precio). "
                    "moves=%s",
                    picking.name, len(pending_dups), pending_dups.ids,
                )
                pending_dups._action_cancel()

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
    #  PICKING POR SHIPMENT (uno por PO)
    # =====================================================================

    def _ensure_po_picking(self, shipment, po, is_main=False):
        """Busca/adopta/crea la recepción de UNA PO dentro del embarque."""
        picking = self._find_picking_for_shipment_po(shipment, po, is_main=is_main)
        if picking:
            return picking

        unlinked_po_pickings = self._get_unlinked_po_pickings(po)
        if unlinked_po_pickings:
            picking = unlinked_po_pickings[0]
            picking.sudo().write({
                "supplier_shipment_id": shipment.id,
                "supplier_cargo_po_id": po.id,
                "origin": self._prepare_picking_origin(po, shipment),
            })
            return picking

        picking_type = self._get_incoming_picking_type(po)
        if not picking_type:
            _logger.error("[Portal] No se encontró tipo de operación incoming para PO %s.", po.name)
            return self.env["stock.picking"].sudo()

        vals = {
            "picking_type_id": picking_type.id,
            "partner_id": po.partner_id.id,
            "company_id": po.company_id.id,
            "origin": self._prepare_picking_origin(po, shipment),
            "location_id": picking_type.default_location_src_id.id,
            "location_dest_id": picking_type.default_location_dest_id.id,
            "supplier_shipment_id": shipment.id,
            "supplier_cargo_po_id": po.id,
        }

        if "move_type" in self.env["stock.picking"]._fields:
            vals["move_type"] = po.picking_ids[:1].move_type if po.picking_ids else "direct"

        return self.env["stock.picking"].sudo().create(vals)

    def get_or_create_picking_for_shipment(self, shipment):
        """Garantiza las recepciones del embarque (una por PO) y devuelve la
        principal — compat con los llamadores existentes."""
        return self._sync_picking_moves_from_shipment(shipment)

    # =====================================================================
    #  CABECERA / SPREADSHEET
    # =====================================================================

    def sync_shipment_header_to_picking(self, shipment):
        main_picking = self.get_or_create_picking_for_shipment(shipment)
        if not main_picking:
            return False

        header = shipment.proforma_id
        Header = self.env['supplier.proforma.header'].sudo()
        container_numbers = list(dict.fromkeys([x for x in shipment.container_ids.mapped("container_number") if x]))
        seal_numbers = list(dict.fromkeys([x for x in shipment.container_ids.mapped("seal_number") if x]))
        container_types = list(dict.fromkeys([x for x in shipment.container_ids.mapped("container_type") if x]))

        base_vals = {
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

        ok = True
        for picking in self._find_pickings_for_shipment(shipment):
            po = picking.supplier_cargo_po_id or header.purchase_id
            po_header = Header.search(
                [('purchase_id', '=', po.id)], limit=1) or header
            vals = dict(
                base_vals,
                origin=self._prepare_picking_origin(po, shipment),
                supplier_proforma_number=po_header.proforma_number or "",
            )
            # Naviera/forwarder del catálogo → recepción (si el módulo del
            # tarifario agregó los campos al picking).
            if 'som_naviera_id' in picking._fields and getattr(shipment, 'naviera_id', False):
                vals['som_naviera_id'] = shipment.naviera_id.id
            if 'som_forwarder_id' in picking._fields and getattr(shipment, 'forwarder_id', False):
                vals['som_forwarder_id'] = shipment.forwarder_id.id
            try:
                picking.sudo().write(vals)
            except Exception:
                ok = False
                _logger.exception(
                    "[Portal] Error sincronizando cabecera de shipment %s al picking %s.",
                    shipment.id, picking.id,
                )
        return main_picking if ok or main_picking else False

    def sync_shipment_rows_to_spreadsheet(self, shipment):
        main_picking = self.get_or_create_picking_for_shipment(shipment)
        if not main_picking:
            return False

        header = shipment.proforma_id
        Header = self.env['supplier.proforma.header'].sudo()
        pos = self._covered_pos_for_shipment(shipment)
        default_po_id = pos[:1].id if pos else 0
        allowed = set(pos.ids)
        rows_by_po = {}

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

                target_po_id = self._row_po_id(row, default_po_id, allowed)
                rows_by_po.setdefault(target_po_id, []).append({
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

        base_header_data = {
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

        ok = True
        for picking in self._find_pickings_for_shipment(shipment):
            po = picking.supplier_cargo_po_id
            po_id = po.id if po else default_po_id
            po_header = Header.search(
                [('purchase_id', '=', po_id)], limit=1) or header
            header_data = dict(
                base_header_data,
                proforma_number=po_header.proforma_number or "",
            )
            try:
                picking.sudo().update_packing_list_from_portal(
                    rows_by_po.get(po_id, []), header_data=header_data)
            except Exception:
                ok = False
                _logger.exception(
                    "[Portal] Error sincronizando filas del shipment %s al spreadsheet del picking %s.",
                    shipment.id, picking.id,
                )
        return ok

    def _allocate_rows_to_po_lines(self, shipment):
        """Asigna a CADA fila de PL su línea de compra (PO) y su PI.

        FIFO determinista y RE-EJECUTABLE sobre todo el alcance de la carga:
        se recorren las filas de todos los embarques de las POs amparadas en
        orden de captura y se llenan las líneas de compra más antiguas primero
        (capacidad = solicitud original congelada). El excedente cae en la
        ÚLTIMA línea del producto para que el saldo quede visible ahí.

        Convención de cantidades: la misma de _po_ordered_qty_map (sin
        conversión de UoM; las líneas de piedra se capturan en la UoM del
        producto). Cada re-sincronización recalcula la asignación completa,
        así que también sanea filas legado sin referencia.
        """
        pos = self._covered_pos_for_shipment(shipment)
        if not pos:
            return
        pos = pos.sorted(lambda p: (p.date_order or fields.Datetime.now(), p.id))

        headers = self.env['supplier.proforma.header'].sudo().search([
            ('purchase_id', 'in', pos.ids),
        ])
        header_by_po = {}
        for header in headers.sorted('id'):
            header_by_po.setdefault(header.purchase_id.id, header)

        lines_by_product = {}
        capacity = {}
        for po in pos:
            for line in po.order_line.filtered(
                lambda l: not l.display_type and l.product_id
            ):
                lines_by_product.setdefault(line.product_id.id, []).append(line)
                capacity[line.id] = (
                    line.x_qty_solicitada_original or line.product_qty or 0.0)

        all_rows = self.env['supplier.shipment.packing.row'].sudo()
        for header in headers:
            for ship in header.shipment_ids.sorted('id'):
                for packing in ship.packing_ids.sorted('id'):
                    all_rows |= packing.row_ids

        po_by_header = {h.id: h.purchase_id.id for h in headers}
        sorted_rows = all_rows.sorted(
            lambda r: (r.packing_id.id, r.sequence, r.id))

        # Dos pasadas: PRIMERO las filas con PI elegida a mano en el portal
        # (consumen la capacidad de SU PO), después el FIFO llena el resto.
        consumed = {}

        def pick_line(lines, qty):
            return next(
                (l for l in lines
                 if consumed.get(l.id, 0.0) + qty
                 <= capacity.get(l.id, 0.0) + 1e-4),
                lines[-1],
            )

        manual_rows = sorted_rows.filtered(
            lambda r: r.pi_manual and r.pi_header_id)
        auto_rows = sorted_rows - manual_rows

        for row in manual_rows:
            po_id = po_by_header.get(row.pi_header_id.id)
            lines = [
                l for l in (lines_by_product.get(row.product_id.id) or [])
                if l.order_id.id == po_id
            ]
            if not lines:
                # La PI elegida no tiene línea de ese producto: se respeta la
                # PI del proveedor y la fila queda sin línea de compra.
                if row.purchase_line_id:
                    row.write({'purchase_line_id': False})
                continue
            qty = self._row_effective_qty(row)
            target = pick_line(lines, qty)
            consumed[target.id] = consumed.get(target.id, 0.0) + qty
            if (row.purchase_line_id.id or False) != target.id:
                row.write({'purchase_line_id': target.id})

        for row in auto_rows.sorted(
                lambda r: (r.packing_id.id, r.sequence, r.id)):
            lines = lines_by_product.get(row.product_id.id) or []
            target = False
            if lines:
                qty = self._row_effective_qty(row)
                target = pick_line(lines, qty)
                consumed[target.id] = consumed.get(target.id, 0.0) + qty
            header = header_by_po.get(target.order_id.id) if target else False
            new_line_id = target.id if target else False
            new_header_id = header.id if header else False
            if (row.purchase_line_id.id or False) != new_line_id \
                    or (row.pi_header_id.id or False) != new_header_id:
                row.write({
                    'purchase_line_id': new_line_id,
                    'pi_header_id': new_header_id,
                })

    def _sync_po_commercial_qty(self, shipment):
        """Actualiza la cantidad COMERCIAL de la OC con lo embarcado real.

        Al proveedor se le paga lo declarado en el Packing List, así que
        product_qty (la cantidad que impacta montos, pagos, comisiones y
        costos) se ajusta al total declarado. La solicitud original se
        congela UNA sola vez en x_qty_solicitada_original.

        Con la trazabilidad por fila (purchase_line_id, asignada en
        _allocate_rows_to_po_lines) el ajuste es POR LÍNEA de compra: las OCs
        con el mismo producto en varias líneas (precios distintos) también se
        actualizan correctamente. Filas legado sin referencia conservan el
        comportamiento anterior: solo se ajustan productos con UNA línea.

        Reglas:
        - Líneas aún sin nada declarado en ningún PL: no se tocan.
        - La PO/PI nunca se cierra sola por saldo; solo se informa.
        """
        pos = self._covered_pos_for_shipment(shipment).filtered(
            lambda p: p.state != 'cancel')
        if not pos:
            return

        po_lines = pos.order_line.filtered(
            lambda l: not l.display_type and l.product_id)
        if not po_lines:
            return

        # Declarado por línea de compra: filas trazadas de TODOS los
        # embarques/cargas que apuntan a líneas de estas POs.
        rows = self.env['supplier.shipment.packing.row'].sudo().search([
            ('purchase_line_id', 'in', po_lines.ids),
        ])
        declared_by_line = {}
        referenced_by_product = {}
        for row in rows:
            qty = self._row_effective_qty(row)
            declared_by_line[row.purchase_line_id.id] = (
                declared_by_line.get(row.purchase_line_id.id, 0.0) + qty)
            pid = row.product_id.id
            referenced_by_product[pid] = (
                referenced_by_product.get(pid, 0.0) + qty)

        # Filas legado sin referencia: diferencia entre el total declarado
        # global y lo ya trazado, repartida solo si el producto tiene UNA
        # línea (mismo criterio que antes de la trazabilidad por fila).
        lines_by_product = {}
        for line in po_lines:
            lines_by_product.setdefault(line.product_id.id, []).append(line)

        for pid, total in self._pos_shipped_qty_map(pos).items():
            unref = total - referenced_by_product.get(pid, 0.0)
            if unref <= 1e-4:
                continue
            lines = lines_by_product.get(pid) or []
            if not lines:
                continue
            if len(lines) > 1:
                _logger.warning(
                    "[PL_SYNC][PO] %s: producto %s tiene %s líneas y filas de "
                    "PL sin trazar; ese remanente no se reparte (ambiguo).",
                    ', '.join(pos.mapped('name')), pid, len(lines),
                )
                continue
            declared_by_line[lines[0].id] = (
                declared_by_line.get(lines[0].id, 0.0) + unref)

        for line in po_lines:
            total = declared_by_line.get(line.id, 0.0)
            if total <= 0:
                continue

            vals = {'x_qty_embarcada': total}
            if not line.x_qty_solicitada_original:
                vals['x_qty_solicitada_original'] = line.product_qty

            if abs((line.product_qty or 0.0) - total) > 1e-6:
                vals['product_qty'] = total
                _logger.info(
                    "[PL_SYNC][PO] %s / %s: cantidad comercial %s -> %s "
                    "(embarcado declarado en PL).",
                    line.order_id.name, line.product_id.display_name,
                    line.product_qty, total,
                )

            line.with_context(skip_date_sync=True).write(vals)

    def sync_shipment(self, shipment):
        # PRIMERO el reparto PI/PO por fila: las recepciones POR PO dependen
        # de saber a qué orden pertenece cada fila del PL.
        self._allocate_rows_to_po_lines(shipment)
        picking = self.sync_shipment_header_to_picking(shipment)
        if not picking:
            return False

        self._sync_po_commercial_qty(shipment)
        self.sync_shipment_rows_to_spreadsheet(shipment)
        return picking

    def sync_all_shipments(self, proforma):
        for shipment in self.sorted_shipments(proforma.shipment_ids):
            self.sync_shipment(shipment)

    # =====================================================================
    #  ELIMINACIÓN
    # =====================================================================

    def delete_picking_for_shipment(self, shipment):
        pickings = self._find_pickings_for_shipment(shipment)
        if not pickings:
            return True

        ok = True
        for picking in pickings:
            if picking.state == "done":
                ok = False
                continue
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
            except Exception:
                ok = False
                _logger.exception(
                    "[Portal] No se pudo eliminar picking %s ligado al shipment %s.",
                    picking.id, shipment.id,
                )
        return ok