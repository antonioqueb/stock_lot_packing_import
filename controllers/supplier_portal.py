# -*- coding: utf-8 -*-
import json
from odoo import http
from odoo.http import request
from markupsafe import Markup
import logging

_logger = logging.getLogger(__name__)

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
        if not products:
            products = []

        # --- LÓGICA BIDIRECCIONAL: RECUPERAR DATOS DEL SPREADSHEET ---
        existing_rows = []
        if picking.spreadsheet_id:
            try:
                existing_rows = picking.sudo().get_packing_list_data_for_portal()
            except Exception as e:
                _logger.error(f"Error recuperando datos del spreadsheet para portal: {e}")
                existing_rows = []

        # Estructura completa de datos para el Frontend
        full_data = {
            'products': products,
            'existing_rows': existing_rows,  # <--- AQUÍ PASAMOS LOS DATOS GUARDADOS
            'token': token,
            'poName': access.purchase_id.name if access.purchase_id else (picking.origin or ""),
            'pickingName': picking.name or "",
            'companyName': picking.company_id.name or ""
        }

        # Serializamos todo el objeto a JSON de una sola vez para seguridad
        json_payload = json.dumps(full_data, ensure_ascii=False)

        values = {
            'picking': picking,
            'portal_json': Markup(json_payload), # Pasamos el JSON seguro
        }
        return request.render('stock_lot_packing_import.supplier_portal_view', values)

    @http.route('/supplier/pl/submit', type='json', auth='public', csrf=False)
    def submit_pl_data(self, token, rows):
        """
        Recibe los datos del portal y actualiza el Spreadsheet.
        NO crea movimientos de stock todavía.
        """
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
            # CAMBIO: Actualizar Spreadsheet en lugar de procesar stock directo
            picking.sudo().update_packing_list_from_portal(rows)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'message': str(e)}