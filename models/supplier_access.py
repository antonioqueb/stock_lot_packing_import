# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta

import re
from urllib.parse import quote

from odoo.exceptions import UserError
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
        help='PO principal del enlace. Con factura de carga, es la primera '
             'de las PO amparadas.',
    )

    cargo_invoice_id = fields.Many2one(
        'supplier.cargo.invoice',
        string='Factura de carga',
        ondelete='cascade',
        index=True,
        help='Cuando el enlace ampara VARIAS PO/PI (factura de carga), '
             'todas viven aquí. Sin carga: enlace clásico de una sola PO.',
    )

    purchase_ids = fields.Many2many(
        'purchase.order',
        string='PO amparadas',
        compute='_compute_purchase_ids',
    )

    def _compute_purchase_ids(self):
        for rec in self:
            if rec.cargo_invoice_id:
                rec.purchase_ids = rec.cargo_invoice_id.purchase_ids
            else:
                rec.purchase_ids = rec.purchase_id

    def _covered_purchase_orders(self):
        """POs que este enlace ampara (helper para servicios del portal)."""
        self.ensure_one()
        if self.cargo_invoice_id and self.cargo_invoice_id.purchase_ids:
            return self.cargo_invoice_id.purchase_ids
        return self.purchase_id

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
        'UNIQUE(purchase_id, cargo_invoice_id)',
        'Ya existe un link para esta Orden de Compra en esta factura de carga.',
    )

    # ── Envío de la liga por WhatsApp (sin documento: saludo + liga +
    #    instrucciones). Mismo espíritu que el compartir de OV/holds. ──
    @staticmethod
    def _som_wa_phone(phone):
        digits = re.sub(r'\D', '', phone or '')
        if len(digits) == 10:
            digits = '52' + digits
        return digits if len(digits) >= 11 else ''

    def _som_wa_message(self):
        self.ensure_one()
        pos = self.purchase_ids
        pis = ', '.join(p.partner_ref or p.name for p in pos) or ''
        vigencia = ''
        if self.expiration_date:
            vigencia = '\n\nEl enlace está vigente hasta el %s.' % (
                fields.Datetime.context_timestamp(
                    self, self.expiration_date).strftime('%d/%m/%Y'))
        return (
            'Buen día:\n\n'
            'Le compartimos el enlace del portal para capturar su embarque '
            '(%s):\n\n%s\n\n'
            'Instrucciones:\n'
            '1. Abra el enlace desde su computadora o celular.\n'
            '2. Capture los datos del embarque: proforma, contenedores, '
            'packing list y documentos.\n'
            '3. Guarde cada sección — su avance se conserva y puede volver '
            'a entrar con el mismo enlace las veces que necesite.%s\n\n'
            'Quedamos atentos a cualquier duda. Saludos cordiales.'
        ) % (pis, self.portal_url, vigencia)

    def action_send_whatsapp(self):
        self.ensure_one()
        if not self.portal_url:
            raise UserError('Este acceso aún no tiene enlace de portal.')
        partner = self.purchase_ids[:1].partner_id
        phone = self._som_wa_phone(partner.phone if partner else '')
        wa = 'https://wa.me/%s?text=%s' % (phone, quote(self._som_wa_message()))
        # El acceso no hereda mail.thread: el registro queda en la carga
        # (si existe) que sí tiene chatter.
        if self.cargo_invoice_id:
            self.cargo_invoice_id.message_post(
                body='Enlace del portal enviado por WhatsApp%s.' % (
                    ' al %s' % phone if phone else ''))
        return {'type': 'ir.actions.act_url', 'url': wa, 'target': 'new'}

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