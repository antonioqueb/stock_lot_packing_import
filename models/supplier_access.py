# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta
from odoo import models, fields, api

class SupplierAccess(models.Model):
    _name = 'stock.picking.supplier.access'
    _description = 'Token de Acceso a Portal de Proveedor'

    picking_id = fields.Many2one('stock.picking', string="Recepción", required=True, ondelete='cascade')
    # Nuevo campo para ver los links desde la PO
    purchase_id = fields.Many2one('purchase.order', string="Orden de Compra", ondelete='cascade')
    
    access_token = fields.Char(string="Token", required=True, default=lambda self: str(uuid.uuid4()), readonly=True)
    expiration_date = fields.Datetime(string="Expira", required=True, default=lambda self: fields.Datetime.now() + timedelta(days=15))
    is_expired = fields.Boolean(compute="_compute_expired")
    portal_url = fields.Char(compute="_compute_url")

    @api.depends('expiration_date')
    def _compute_expired(self):
        for rec in self:
            rec.is_expired = rec.expiration_date < fields.Datetime.now()

    @api.depends('access_token')
    def _compute_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        for rec in self:
            rec.portal_url = f"{base_url}/supplier/pl/{rec.access_token}"