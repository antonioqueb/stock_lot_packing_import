# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError

class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    supplier_access_ids = fields.One2many('stock.picking.supplier.access', 'purchase_id', string="Links Proveedor")

    def action_generate_supplier_link(self):
        """ 
        Busca la recepción (picking) pendiente asociada a esta PO y genera el link.
        """
        self.ensure_one()
        
        if self.state not in ['purchase', 'done']:
            raise UserError("Debe confirmar la Orden de Compra antes de enviar el link al proveedor.")

        # Buscar recepciones pendientes (no canceladas ni validadas) asociadas a esta PO
        pickings = self.picking_ids.filtered(
            lambda p: p.state not in ('done', 'cancel') and p.picking_type_code == 'incoming'
        )

        if not pickings:
            raise UserError("No se encontraron recepciones pendientes para esta Orden de Compra. Verifique que no hayan sido validadas o canceladas.")

        # Tomamos la primera recepción disponible (usualmente la principal o el backorder actual)
        target_picking = pickings[0]

        # Crear el acceso vinculado a la recepción y a la PO
        access = self.env['stock.picking.supplier.access'].create({
            'picking_id': target_picking.id,
            'purchase_id': self.id
        })

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Link Generado para Proveedor',
                'message': f'Link creado para recepción {target_picking.name}: {access.portal_url}',
                'type': 'success',
                'sticky': True,
            }
        }