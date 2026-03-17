# -*- coding: utf-8 -*-
from datetime import timedelta

from odoo import models, fields, api, _
from odoo.exceptions import UserError


class PurchaseSupplierPortalLinkWizard(models.TransientModel):
    _name = 'purchase.supplier.portal.link.wizard'
    _description = 'Wizard: Copiar Link Portal Proveedor'

    purchase_id = fields.Many2one(
        'purchase.order',
        string='Orden de Compra',
        required=True,
        readonly=True,
    )
    access_id = fields.Many2one(
        'stock.picking.supplier.access',
        string='Acceso',
        readonly=True,
    )

    portal_url = fields.Char(string='Link', readonly=True)
    expiration_date = fields.Datetime(string='Expira', readonly=True)

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

        access = po._get_or_create_supplier_access()

        res.update({
            'access_id': access.id,
            'portal_url': access.portal_url,
            'expiration_date': access.expiration_date,
        })
        return res

    def action_refresh(self):
        self.ensure_one()

        new_expiration = fields.Datetime.now() + timedelta(days=365)

        self.access_id.write({
            'expiration_date': new_expiration,
        })

        self.write({
            'portal_url': self.access_id.portal_url,
            'expiration_date': self.access_id.expiration_date,
        })

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Link actualizado'),
                'message': _('Se renovó la vigencia del link. El token no cambió.'),
                'type': 'success',
                'sticky': False,
            }
        }