# -*- coding: utf-8 -*-
"""Factura de Carga: agrupa varias PI/PO en UN solo enlace de portal.

Es el detonador del embarque (punto 4 del flujo): cuando el proveedor avisa
qué material está listo, Compras selecciona todas las PO/PI amparadas por esa
factura y Odoo genera UN enlace contextualizado — nunca un enlace por PO.

Compatibilidad: una carga con una sola PO se comporta exactamente como el
flujo actual (el enlace clásico por OC sigue funcionando sin carga).
"""
import logging

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


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

    # ------------------------------------------------------------------
    # Resumen ejecutivo de la carga (todo computado, nada que capturar)
    # ------------------------------------------------------------------
    currency_id = fields.Many2one(
        'res.currency', compute='_compute_summary', string='Moneda',
    )
    amount_total = fields.Monetary(
        string='Importe total', compute='_compute_summary',
        currency_field='currency_id',
        help='Suma de los importes de todas las OC amparadas.',
    )
    purchase_count = fields.Integer(compute='_compute_summary')
    shipment_count = fields.Integer(compute='_compute_summary')
    packing_count = fields.Integer(
        string='Packing Lists', compute='_compute_summary',
    )
    container_count = fields.Integer(
        string='Contenedores', compute='_compute_summary',
    )
    missing_pi_names = fields.Char(compute='_compute_summary')

    ordered_display = fields.Char(
        string='Pedido', compute='_compute_material',
        help='Total solicitado en las OC amparadas (solicitud original).',
    )
    shipped_display = fields.Char(
        string='Embarcado', compute='_compute_material',
        help='Total declarado en los Packing Lists del portal.',
    )
    pending_display = fields.Char(
        string='Pendiente por embarcar', compute='_compute_material',
    )

    capture_progress = fields.Integer(
        string='Avance de captura', compute='_compute_portal_info',
        help='Promedio del avance de captura del portal en las PI de la carga.',
    )
    access_expiration = fields.Datetime(
        string='Vigencia del enlace', compute='_compute_portal_info',
    )
    last_access = fields.Datetime(
        string='Último acceso del proveedor', compute='_compute_portal_info',
    )

    def _cargo_headers(self):
        self.ensure_one()
        if not self.purchase_ids:
            return self.env['supplier.proforma.header']
        return self.env['supplier.proforma.header'].sudo().search([
            ('purchase_id', 'in', self.purchase_ids.ids),
        ])

    @api.depends('purchase_ids.amount_total', 'purchase_ids.partner_ref')
    def _compute_summary(self):
        for rec in self:
            pos = rec.purchase_ids
            rec.purchase_count = len(pos)
            rec.currency_id = pos[:1].currency_id
            rec.amount_total = sum(pos.mapped('amount_total'))
            shipments = rec._cargo_headers().mapped('shipment_ids')
            rec.shipment_count = len(shipments)
            rec.packing_count = len(shipments.mapped('packing_ids'))
            rec.container_count = len(shipments.mapped('container_ids'))
            missing = pos.filtered(lambda p: not p.partner_ref)
            rec.missing_pi_names = ', '.join(missing.mapped('name'))

    @staticmethod
    def _cargo_fmt_qty(qty, uom):
        if abs(qty - round(qty)) < 0.005:
            num = '%d' % round(qty)
        else:
            num = ('%.2f' % qty).rstrip('0').rstrip('.')
        return '%s %s' % (num, uom) if uom else num

    @classmethod
    def _cargo_uom_display(cls, qty_map):
        parts = [
            cls._cargo_fmt_qty(q, u)
            for u, q in sorted(qty_map.items()) if abs(q) > 0.005
        ]
        return ' · '.join(parts) if parts else '—'

    @api.depends('purchase_ids.order_line.product_qty')
    def _compute_material(self):
        for rec in self:
            ordered = {}
            for line in rec.purchase_ids.order_line:
                if line.display_type or not line.product_id:
                    continue
                uom = line.product_id.uom_id.name or '?'
                qty = line.x_qty_solicitada_original or line.product_qty or 0.0
                ordered[uom] = ordered.get(uom, 0.0) + qty

            shipped = {}
            for shipment in rec._cargo_headers().mapped('shipment_ids'):
                for packing in shipment.packing_ids:
                    for row in packing.row_ids:
                        uom = row.product_id.uom_id.name or '?'
                        shipped[uom] = shipped.get(uom, 0.0) + (row.area_m2 or 0.0)

            pending = {
                uom: max(qty - shipped.get(uom, 0.0), 0.0)
                for uom, qty in ordered.items()
            }
            rec.ordered_display = self._cargo_uom_display(ordered)
            rec.shipped_display = self._cargo_uom_display(shipped)
            rec.pending_display = self._cargo_uom_display(pending)

    @api.depends('access_ids.last_access', 'access_ids.expiration_date',
                 'purchase_ids')
    def _compute_portal_info(self):
        for rec in self:
            access = rec.access_ids[:1]
            rec.access_expiration = access.expiration_date
            rec.last_access = access.last_access
            # El avance real de captura vive en las proformas CON embarques
            # (la captura de la carga sucede en una sola sesión de portal);
            # las PI hermanas sin embarques no diluyen el promedio.
            headers = rec._cargo_headers()
            with_shipments = headers.filtered(lambda h: h.shipment_ids)
            percents = []
            for header in (with_shipments or headers):
                percents.append(self._header_capture_percent(header))
            rec.capture_progress = (
                round(sum(percents) / len(percents)) if percents else 0)

    @api.model
    def _header_capture_percent(self, header):
        """Avance de UNA proforma con precedencia clara:
        1) el % reportado por el PROPIO portal (idéntico a lo que ve el
           proveedor), 2) 100 si ya está marcada como completa, 3) cálculo
        interno como último recurso (enlaces nunca abiertos tras el deploy)."""
        stored = getattr(header, 'portal_overall_pct', 0) or 0
        if stored > 0:
            return stored
        if (header.status or '') == 'complete':
            return 100
        try:
            return self._progress_percent_capture(header._portal_progress())
        except Exception:
            _logger.exception(
                "[Cargo] No se pudo calcular el avance de la proforma %s.",
                header.id)
            return 0

    @staticmethod
    def _progress_percent_capture(progress):
        """% con la MISMA vara que el portal del proveedor: solo lo que ÉL
        debe capturar. Se excluyen los documentos opcionales (EUR1, cert. de
        origen, fumigación) y los datos generales (en cargas los pre-llena
        Compras). Así un enlace terminado marca 100."""
        skip_suffixes = ('_doc_eur1', '_doc_certificate_origin', '_doc_fumigation')
        total = 0
        done = 0
        for key, sec in (progress.get('sections') or {}).items():
            if key == 'globals' or key.endswith(skip_suffixes):
                continue
            weight = sec.get('weight') or 0
            total += weight
            if sec.get('filled'):
                done += weight
        if not total:
            return progress.get('percent', 0)
        return round(done / total * 100)

    def action_view_purchases(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Órdenes de compra'),
            'res_model': 'purchase.order',
            'view_mode': 'list,form',
            'domain': [('id', 'in', self.purchase_ids.ids)],
        }

    def action_view_shipments(self):
        self.ensure_one()
        shipments = self._cargo_headers().mapped('shipment_ids')
        return {
            'type': 'ir.actions.act_window',
            'name': _('Embarques'),
            'res_model': 'supplier.shipment',
            'view_mode': 'list,form',
            'domain': [('id', 'in', shipments.ids)],
        }

    @api.depends('purchase_ids.partner_id')
    def _compute_partner_id(self):
        for rec in self:
            partners = rec.purchase_ids.mapped('partner_id')
            rec.partner_id = partners[:1]

    @api.depends('purchase_ids.partner_ref', 'purchase_ids.name')
    def _compute_pi_summary(self):
        for rec in self:
            parts = []
            for po in rec.purchase_ids:
                if po.partner_ref:
                    parts.append('%s ↔ PI %s' % (po.name, po.partner_ref))
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
                    'proforma_number': po.partner_ref or '',
                })
            elif po.partner_ref and not header.proforma_number:
                header.with_context(skip_pi_sync=True).write({
                    'proforma_number': po.partner_ref,
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
