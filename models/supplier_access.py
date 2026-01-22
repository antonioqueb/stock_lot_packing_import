# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta
from odoo import models, fields, api


class SupplierAccess(models.Model):
    _name = 'stock.picking.supplier.access'
    _description = 'Token de Acceso a Portal de Proveedor'
    _order = 'create_date desc'

    picking_id = fields.Many2one('stock.picking', string="Recepción", required=True, ondelete='cascade')
    purchase_id = fields.Many2one('purchase.order', string="Orden de Compra", ondelete='cascade')

    access_token = fields.Char(
        string="Token", required=True, default=lambda self: str(uuid.uuid4()), readonly=True, copy=False
    )
    expiration_date = fields.Datetime(
        string="Expira",
        required=True,
        default=lambda self: fields.Datetime.now() + timedelta(days=15),
        copy=False
    )
    is_expired = fields.Boolean(compute="_compute_expired", store=False)
    portal_url = fields.Char(compute="_compute_url", store=False)

    _sql_constraints = [
        # 1 link por PO. (PostgreSQL permite múltiples NULL en UNIQUE, así que no rompe casos sin purchase_id)
        ('supplier_access_unique_purchase', 'unique(purchase_id)', 'Ya existe un link para esta Orden de Compra.'),
    ]

    @api.depends('expiration_date')
    def _compute_expired(self):
        now = fields.Datetime.now()
        for rec in self:
            rec.is_expired = bool(rec.expiration_date and rec.expiration_date < now)

    @api.depends('access_token')
    def _compute_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        for rec in self:
            rec.portal_url = f"{base_url}/supplier/pl/{rec.access_token}"
