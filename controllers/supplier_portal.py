# -*- coding: utf-8 -*-
import json
from odoo import http
from odoo.http import request


class SupplierPortalController(http.Controller):

    def _get_picking_moves_for_portal(self, picking):
        """
        Compatibilidad entre versiones/builds:
        - Si existe move_ids_without_package lo usamos.
        - Si no, usamos move_ids.
        """
        moves = False
        if hasattr(picking, "move_ids_without_package"):
            moves = picking.move_ids_without_package
        if not moves:
            moves = picking.move_ids
        # Evitar cancelados
        return moves.filtered(lambda m: m.state != "cancel")

    def _build_products_payload(self, picking):
        """
        Regresa lista de productos agregada por product_id:
        - qty_ordered = suma de product_uom_qty por producto (por si hay varios moves)
        """
        moves = self._get_picking_moves_for_portal(picking)
        bucket = {}

        for move in moves:
            product = move.product_id
            if not product:
                continue

            pid = product.id
            if pid not in bucket:
                bucket[pid] = {
                    "id": pid,
                    "name": product.display_name or product.name,
                    "code": product.default_code or "",
                    "qty_ordered": 0.0,
                    "uom": (move.product_uom and move.product_uom.name) or "",
                }
            bucket[pid]["qty_ordered"] += (move.product_uom_qty or 0.0)

        # Orden estable por nombre
        products = list(bucket.values())
        products.sort(key=lambda x: (x.get("name") or "").lower())
        return products

    @http.route('/supplier/pl/<string:token>', type='http', auth='public', website=True, sitemap=False)
    def view_supplier_portal(self, token, **kwargs):
        access = request.env['stock.picking.supplier.access'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not access:
            return request.render('stock_lot_packing_import.portal_not_found')
        if access.is_expired:
            return request.render('stock_lot_packing_import.portal_expired')

        # Si viene de una PO, movemos el picking al “vigente” (backorder actual), sin cambiar token
        if access.purchase_id:
            po = access.purchase_id
            pickings = po.picking_ids.filtered(
                lambda p: p.picking_type_code == 'incoming' and p.state not in ('done', 'cancel')
            )
            if pickings:
                target_picking = pickings.sorted(key=lambda p: p.id, reverse=True)[0]
                if access.picking_id.id != target_picking.id:
                    access.write({'picking_id': target_picking.id})

        picking = access.picking_id
        if not picking:
            return request.render('stock_lot_packing_import.portal_not_found')

        products = self._build_products_payload(picking)

        portal_data = {
            'picking': picking,
            'products_json': json.dumps(products, ensure_ascii=False),
            'token': token,
            'company': picking.company_id,
            # Mejor que origin: nombre de OC si existe
            'po_name': access.purchase_id.name if access.purchase_id else (picking.origin or ""),
        }
        return request.render('stock_lot_packing_import.supplier_portal_view', portal_data)

    # IMPORTANTE: type='json' (no jsonrpc). Odoo usa JSON-RPC automáticamente para routes tipo json.
    @http.route('/supplier/pl/submit', type='json', auth='public', csrf=False)
    def submit_pl_data(self, token, rows):
        access = request.env['stock.picking.supplier.access'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not access or access.is_expired:
            return {'success': False, 'message': 'Token inválido o expirado.'}

        picking = access.picking_id
        if not picking:
            return {'success': False, 'message': 'No se encontró la recepción asociada al token.'}

        if picking.state in ('done', 'cancel'):
            return {'success': False, 'message': 'La recepción ya fue procesada.'}

        try:
            picking.sudo().process_external_pl_data(rows)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'message': str(e)}
