# -*- coding: utf-8 -*-
from odoo import models, fields, api, _


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    discrepancy_ids = fields.One2many(
        'purchase.discrepancy', 'picking_id', string='Discrepancias',
    )
    discrepancy_count = fields.Integer(
        string='Discrepancias', compute='_compute_discrepancy_count',
    )

    @api.depends('discrepancy_ids')
    def _compute_discrepancy_count(self):
        for picking in self:
            picking.discrepancy_count = len(picking.discrepancy_ids)

    def action_view_discrepancies(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Discrepancias de Proveedor'),
            'res_model': 'purchase.discrepancy',
            'view_mode': 'list,form',
            'domain': [('picking_id', '=', self.id)],
            'context': {
                'default_picking_id': self.id,
                'default_partner_id': self.partner_id.id,
            },
        }

    def action_create_discrepancy(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Registrar Discrepancia'),
            'res_model': 'purchase.discrepancy',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_picking_id': self.id,
                'default_partner_id': self.partner_id.id,
            },
        }
