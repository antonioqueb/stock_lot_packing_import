# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class PurchaseSupplierPortalLinkWizard(models.TransientModel):
    _name = 'purchase.supplier.portal.link.wizard'
    _description = 'Wizard: Copiar Link Portal Proveedor'

    purchase_id = fields.Many2one('purchase.order', string='Orden de Compra', required=True, readonly=True)
    access_id = fields.Many2one('stock.picking.supplier.access', string='Acceso', readonly=True)

    portal_url = fields.Char(string='Link', readonly=True)
    expiration_date = fields.Datetime(string='Expira', readonly=True)
    picking_id = fields.Many2one('stock.picking', string='Recepción', readonly=True)

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        purchase_id = res.get('purchase_id') or self.env.context.get('default_purchase_id')
        if not purchase_id:
            return res

        po = self.env['purchase.order'].browse(purchase_id).exists()
        if not po:
            return res

        if po.state not in ['purchase', 'done']:
            raise UserError(_("Debe confirmar la Orden de Compra antes de generar el link."))

        target_picking = po._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        access = po._get_or_create_supplier_access(target_picking)

        res.update({
            'access_id': access.id,
            'portal_url': access.portal_url,
            'expiration_date': access.expiration_date,
            'picking_id': access.picking_id.id,
        })
        return res

    def action_refresh(self):
        """Refresca picking vigente y renueva expiración manteniendo el mismo token."""
        self.ensure_one()
        po = self.purchase_id
        target_picking = po._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        access = po._get_or_create_supplier_access(target_picking)

        self.write({
            'access_id': access.id,
            'portal_url': access.portal_url,
            'expiration_date': access.expiration_date,
            'picking_id': access.picking_id.id,
        })

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Link actualizado'),
                'message': _('Se renovó la vigencia y se apuntó a la recepción vigente. El link NO cambió.'),
                'type': 'success',
                'sticky': False,
            }
        }
