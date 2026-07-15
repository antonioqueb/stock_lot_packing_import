# -*- coding: utf-8 -*-
"""Factura de Carga: agrupa varias PI/PO en UN solo enlace de portal.

Es el detonador del embarque (punto 4 del flujo): cuando el proveedor avisa
qué material está listo, Compras selecciona todas las PO/PI amparadas por esa
factura y Odoo genera UN enlace contextualizado — nunca un enlace por PO.

Compatibilidad: una carga con una sola PO se comporta exactamente como el
flujo actual (el enlace clásico por OC sigue funcionando sin carga).
"""
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class SupplierCargoInvoice(models.Model):
    _name = 'supplier.cargo.invoice'
    _description = 'Factura de Carga (Embarque multi-PO)'
    _inherit = ['mail.thread']
    _order = 'date desc, id desc'

    name = fields.Char(
        string='Factura de carga', required=True, tracking=True,
        help='Número de la factura de carga/embarque del proveedor.',
    )
    date = fields.Date(
        string='Fecha', default=fields.Date.context_today, tracking=True,
    )
    partner_id = fields.Many2one(
        'res.partner', string='Proveedor',
        compute='_compute_partner_id', store=True,
    )
    purchase_ids = fields.Many2many(
        'purchase.order',
        'supplier_cargo_invoice_po_rel', 'cargo_id', 'purchase_id',
        string='PO / PI amparadas', required=True,
        domain="[('state', 'in', ['purchase', 'done'])]",
    )
    access_ids = fields.One2many(
        'stock.picking.supplier.access', 'cargo_invoice_id',
        string='Enlaces de portal',
    )
    state = fields.Selection([
        ('draft', 'Borrador'),
        ('linked', 'Enlace generado'),
        ('shipped', 'Embarcada'),
        ('closed', 'Cerrada'),
    ], string='Estado', default='draft', tracking=True)

    pi_summary = fields.Char(
        string='PI amparadas', compute='_compute_pi_summary',
    )
    portal_url = fields.Char(
        string='Enlace del portal', compute='_compute_portal_url',
    )

    @api.depends('purchase_ids.partner_id')
    def _compute_partner_id(self):
        for rec in self:
            partners = rec.purchase_ids.mapped('partner_id')
            rec.partner_id = partners[:1]

    @api.depends('purchase_ids.supplier_pi_number', 'purchase_ids.name')
    def _compute_pi_summary(self):
        for rec in self:
            parts = []
            for po in rec.purchase_ids:
                if po.supplier_pi_number:
                    parts.append('%s ↔ PI %s' % (po.name, po.supplier_pi_number))
                else:
                    parts.append(po.name)
            rec.pi_summary = ' · '.join(parts)

    @api.depends('access_ids.portal_url')
    def _compute_portal_url(self):
        for rec in self:
            rec.portal_url = rec.access_ids[:1].portal_url or ''

    @api.constrains('purchase_ids')
    def _check_same_partner(self):
        for rec in self:
            partners = rec.purchase_ids.mapped('partner_id')
            if len(partners) > 1:
                raise UserError(_(
                    'Todas las órdenes de compra de una factura de carga deben '
                    'ser del MISMO proveedor. Encontrados: %s'
                ) % ', '.join(partners.mapped('name')))

    def action_generate_link(self):
        """Genera (o reutiliza) el enlace ÚNICO del portal para esta carga."""
        self.ensure_one()

        if not self.purchase_ids:
            raise UserError(_('Selecciona al menos una orden de compra.'))

        unconfirmed = self.purchase_ids.filtered(
            lambda po: po.state not in ('purchase', 'done'))
        if unconfirmed:
            raise UserError(_(
                'Estas órdenes no están confirmadas: %s. La PO debe existir y '
                'estar confirmada ANTES del embarque.'
            ) % ', '.join(unconfirmed.mapped('name')))

        Access = self.env['stock.picking.supplier.access'].sudo()
        access = self.access_ids[:1]
        if not access:
            # PO principal: la primera de la carga (compat con el flujo 1-PO).
            access = Access.create({
                'purchase_id': self.purchase_ids[0].id,
                'cargo_invoice_id': self.id,
            })

        # Asegura proforma por CADA PO de la carga (PI 1:1 con PO), pre-llenada
        # con el número de PI si Compras ya lo capturó.
        Header = self.env['supplier.proforma.header'].sudo()
        for po in self.purchase_ids:
            header = Header.search([('purchase_id', '=', po.id)], limit=1)
            if not header:
                header = Header.create({
                    'purchase_id': po.id,
                    'access_id': access.id,
                    'proforma_number': po.supplier_pi_number or '',
                })
            elif po.supplier_pi_number and not header.proforma_number:
                header.with_context(skip_pi_sync=True).write({
                    'proforma_number': po.supplier_pi_number,
                })

        if self.state == 'draft':
            self.state = 'linked'

        self.message_post(body=_(
            'Enlace de portal generado para %s PO: %s'
        ) % (len(self.purchase_ids), ', '.join(self.purchase_ids.mapped('name'))))

        return {
            'type': 'ir.actions.act_url',
            'url': access.portal_url,
            'target': 'new',
        }

    @api.model
    def action_create_from_purchases(self, purchase_ids):
        """Acción de servidor: crear carga desde la lista de OCs (multi-select)."""
        pos = self.env['purchase.order'].browse(purchase_ids).exists()
        if not pos:
            raise UserError(_('Selecciona órdenes de compra.'))
        cargo = self.create({
            'name': _('Nueva'),
            'purchase_ids': [(6, 0, pos.ids)],
        })
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'supplier.cargo.invoice',
            'res_id': cargo.id,
            'view_mode': 'form',
            'target': 'current',
        }
