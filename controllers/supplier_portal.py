# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request
import json

class SupplierPortalController(http.Controller):

    @http.route('/supplier/pl/<string:token>', type='http', auth='public')
    def view_supplier_portal(self, token, **kwargs):
        access = request.env['stock.picking.supplier.access'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not access:
            return request.render('stock_lot_dimensions.portal_not_found')
        if access.is_expired:
            return request.render('stock_lot_dimensions.portal_expired')

        # Datos iniciales para el JS
        picking = access.picking_id
        products = []
        for move in picking.move_ids:
            products.append({
                'id': move.product_id.id,
                'name': move.product_id.name,
                'code': move.product_id.default_code or '',
                'qty_ordered': move.product_uom_qty,
                'uom': move.product_uom.name
            })

        return request.render('stock_lot_dimensions.supplier_portal_view', {
            'picking': picking,
            'products_json': json.dumps(products),
            'token': token,
            'company': picking.company_id
        })

    @http.route('/supplier/pl/submit', type='json', auth='public')
    def submit_pl_data(self, token, rows):
        access = request.env['stock.picking.supplier.access'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not access or access.is_expired:
            return {'success': False, 'message': 'Token inválido o expirado.'}

        picking = access.picking_id
        if picking.state in ['done', 'cancel']:
             return {'success': False, 'message': 'La recepción ya fue procesada, no se admiten cambios.'}

        try:
            # Llamamos al método en el modelo para procesar la data
            picking.process_external_pl_data(rows)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'message': str(e)}