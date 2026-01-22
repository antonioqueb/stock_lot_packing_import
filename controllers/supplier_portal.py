# -*- coding: utf-8 -*-
import json
from odoo import http
from odoo.http import request


class SupplierPortalController(http.Controller):

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

        products = []
        for move in picking.move_ids:
            products.append({
                'id': move.product_id.id,
                'name': move.product_id.name,
                'code': move.product_id.default_code or '',
                'qty_ordered': move.product_uom_qty,
                'uom': move.product_uom.name
            })

        return request.render('stock_lot_packing_import.supplier_portal_view', {
            'picking': picking,
            'products_json': json.dumps(products),
            'token': token,
            'company': picking.company_id
        })

    @http.route('/supplier/pl/submit', type='jsonrpc', auth='public', csrf=False)
    def submit_pl_data(self, token, rows):
        access = request.env['stock.picking.supplier.access'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not access or access.is_expired:
            return {'success': False, 'message': 'Token inválido o expirado.'}

        picking = access.picking_id
        if picking.state in ['done', 'cancel']:
            return {'success': False, 'message': 'La recepción ya fue procesada.'}

        try:
            picking.process_external_pl_data(rows)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'message': str(e)}
