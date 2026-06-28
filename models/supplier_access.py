# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta

from odoo import models, fields, api


class SupplierAccess(models.Model):
    _name = 'stock.picking.supplier.access'
    _description = 'Token de Acceso a Portal de Proveedor'
    _order = 'create_date desc'

    purchase_id = fields.Many2one(
        'purchase.order',
        string="Orden de Compra",
        required=True,
        ondelete='cascade',
    )

    # Se conserva SOLO por compatibilidad visual / legacy.
    # Ya no es el ancla funcional del portal.
    picking_id = fields.Many2one(
        'stock.picking',
        string="Recepción legacy",
        required=False,
        ondelete='set null',
        help='Campo legacy. El portal ya no depende de una sola recepción.',
    )

    access_token = fields.Char(
        string="Token",
        required=True,
        default=lambda self: str(uuid.uuid4()),
        readonly=True,
        copy=False,
    )
    expiration_date = fields.Datetime(
        string="Expira",
        required=True,
        default=lambda self: fields.Datetime.now() + timedelta(days=365),
        copy=False,
    )
    is_expired = fields.Boolean(compute="_compute_expired", store=False)
    portal_url = fields.Char(compute="_compute_url", store=False)

    last_access = fields.Datetime(
        string="Última conexión",
        readonly=True,
        copy=False,
        help="Última vez que el proveedor entró al portal a capturar datos.",
    )

    _supplier_access_unique_purchase = models.Constraint(
        'UNIQUE(purchase_id)',
        'Ya existe un link para esta Orden de Compra.',
    )

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

    def _touch_last_access(self):
        """Sella la última conexión del proveedor. Con throttle de 5 minutos para
        no escribir en cada RPC del portal (el llenado dispara muchas llamadas)."""
        now = fields.Datetime.now()
        threshold = now - timedelta(minutes=5)
        to_stamp = self.filtered(lambda a: not a.last_access or a.last_access < threshold)
        if to_stamp:
            to_stamp.sudo().write({'last_access': now})

    def action_open_portal(self):
        """Abre el portal del proveedor en una pestaña nueva."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_url',
            'url': self.portal_url,
            'target': 'new',
        }