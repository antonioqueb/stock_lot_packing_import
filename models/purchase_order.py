# -*- coding: utf-8 -*-
from datetime import timedelta
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    supplier_access_ids = fields.One2many(
        'stock.picking.supplier.access', 'purchase_id', string="Links Proveedor"
    )

    def _get_target_incoming_picking_for_supplier_portal(self):
        """Devuelve la recepción 'vigente' para el portal:
        - Incoming
        - No done/cancel
        - Preferimos la más reciente (backorder actual suele ser el último).
        """
        self.ensure_one()

        pickings = self.picking_ids.filtered(
            lambda p: p.picking_type_code == 'incoming' and p.state not in ('done', 'cancel')
        )
        if not pickings:
            return False

        # Elegimos el más reciente como “vigente”
        return pickings.sorted(key=lambda p: p.id, reverse=True)[0]

    def _get_or_create_supplier_access(self, target_picking):
        """Garantiza 1 acceso por PO (token estable).
        - Si ya existe, NO cambia token.
        - Actualiza picking_id a la recepción vigente.
        - Renueva expiración (opcional: aquí se renueva siempre).
        """
        self.ensure_one()

        access = self.env['stock.picking.supplier.access'].sudo().search(
            [('purchase_id', '=', self.id)], limit=1
        )

        vals_update = {}
        if target_picking and (not access or access.picking_id.id != target_picking.id):
            vals_update['picking_id'] = target_picking.id

        # Mantener token SIEMPRE. Renovamos vigencia para que “generar de nuevo” no cambie URL.
        vals_update['expiration_date'] = fields.Datetime.now() + timedelta(days=15)

        if access:
            if vals_update:
                access.write(vals_update)
            return access

        # Si no existe, crearlo por primera vez
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        return self.env['stock.picking.supplier.access'].sudo().create({
            'purchase_id': self.id,
            'picking_id': target_picking.id,
            'expiration_date': vals_update['expiration_date'],
        })

    def action_open_supplier_link_wizard(self):
        """Abre wizard para copiar el link (y de paso asegura el access único por PO)."""
        self.ensure_one()

        if self.state not in ['purchase', 'done']:
            raise UserError(_("Debe confirmar la Orden de Compra antes de enviar el link al proveedor."))

        target_picking = self._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        # Garantiza token estable
        self._get_or_create_supplier_access(target_picking)

        return {
            'type': 'ir.actions.act_window',
            'name': _('Link Portal Proveedor'),
            'res_model': 'purchase.supplier.portal.link.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_purchase_id': self.id,
            }
        }
