# -*- coding: utf-8 -*-
import json
from odoo import http
from odoo.http import request
from markupsafe import Markup
import logging

_logger = logging.getLogger(__name__)

class SupplierPortalController(http.Controller):

    def _get_picking_moves_for_portal(self, picking):
        moves = False
        if hasattr(picking, "move_ids_without_package"):
            moves = picking.move_ids_without_package
        if not moves:
            moves = picking.move_ids
        return moves.filtered(lambda m: m.state != "cancel")

    def _build_products_payload(self, picking):
        moves = self._get_picking_moves_for_portal(picking)
        bucket = {}
        for move in moves:
            product = move.product_id
            if not product: continue
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
        products = list(bucket.values())
        products.sort(key=lambda x: (x.get("name") or "").lower())
        return products

    @http.route('/supplier/pl/<string:token>', type='http', auth='public', website=True, sitemap=False)
    def view_supplier_portal(self, token, **kwargs):
        access = request.env['stock.picking.supplier.access'].sudo().search([('access_token', '=', token)], limit=1)

        if not access: return request.render('stock_lot_packing_import.portal_not_found')
        if access.is_expired: return request.render('stock_lot_packing_import.portal_expired')

        if access.purchase_id:
            po = access.purchase_id
            pickings = po.picking_ids.filtered(lambda p: p.picking_type_code == 'incoming' and p.state not in ('done', 'cancel'))
            if pickings:
                target_picking = pickings.sorted(key=lambda p: p.id, reverse=True)[0]
                if access.picking_id.id != target_picking.id:
                    access.write({'picking_id': target_picking.id})

        picking = access.picking_id
        if not picking: return request.render('stock_lot_packing_import.portal_not_found')

        products = self._build_products_payload(picking)
        if not products: products = []

        # --- DATOS EXISTENTES ---
        existing_rows = []
        if picking.spreadsheet_id:
            try:
                existing_rows = picking.sudo().get_packing_list_data_for_portal()
            except Exception as e:
                _logger.error(f"Error recuperando datos del spreadsheet: {e}")
                existing_rows = []

        # --- DATOS DE CABECERA (CARGAR SI EXISTEN) ---
        header_data = {
            'invoice_number': picking.supplier_invoice_number or "",
            'shipment_date': str(picking.supplier_shipment_date) if picking.supplier_shipment_date else "",
            'proforma_number': picking.supplier_proforma_number or "",
            'bl_number': picking.supplier_bl_number or "",
            'origin': picking.supplier_origin or "",
            'destination': picking.supplier_destination or "",
            'country_origin': picking.supplier_country_origin or "",
            'vessel': picking.supplier_vessel or "",
            'incoterm_payment': picking.supplier_incoterm_payment or "",
            'merchandise_desc': picking.supplier_merchandise_desc or "",
            'container_no': picking.supplier_container_no or "",
            'seal_no': picking.supplier_seal_no or "",
            'container_type': picking.supplier_container_type or "",
            'total_packages': picking.supplier_total_packages or 0,
            'gross_weight': picking.supplier_gross_weight or 0.0,
            'volume': picking.supplier_volume or 0.0,
            'status': picking.supplier_status or ""
        }

        full_data = {
            'products': products,
            'existing_rows': existing_rows,
            'header': header_data, # <--- Enviamos la cabecera
            'token': token,
            'poName': access.purchase_id.name if access.purchase_id else (picking.origin or ""),
            'pickingName': picking.name or "",
            'companyName': picking.company_id.name or ""
        }

        json_payload = json.dumps(full_data, ensure_ascii=False)

        values = {
            'picking': picking,
            'portal_json': Markup(json_payload),
        }
        return request.render('stock_lot_packing_import.supplier_portal_view', values)

    @http.route('/supplier/pl/submit', type='json', auth='public', csrf=False)
    def submit_pl_data(self, token, rows, header=None):
        """
        Recibe filas y datos de cabecera.
        """
        access = request.env['stock.picking.supplier.access'].sudo().search([('access_token', '=', token)], limit=1)
        if not access or access.is_expired:
            return {'success': False, 'message': 'Token inválido.'}
        
        picking = access.picking_id
        if not picking: return {'success': False, 'message': 'Picking no encontrado.'}
        if picking.state in ('done', 'cancel'): return {'success': False, 'message': 'Recepción ya procesada.'}

        try:
            # Actualizar Picking + Spreadsheet
            picking.sudo().update_packing_list_from_portal(rows, header_data=header)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'message': str(e)}