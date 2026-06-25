# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from markupsafe import Markup, escape


class PurchaseDiscrepancy(models.Model):
    _name = 'purchase.discrepancy'
    _description = 'Discrepancia de Proveedor'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'date desc, id desc'
    _rec_name = 'name'

    name = fields.Char(
        string='Referencia', required=True, copy=False, readonly=True,
        default=lambda self: _('Nuevo'),
    )
    picking_id = fields.Many2one(
        'stock.picking', string='Recepción', required=True, ondelete='cascade',
        index=True, tracking=True,
        domain="[('picking_type_code', '=', 'incoming')]",
    )
    partner_id = fields.Many2one(
        'res.partner', string='Proveedor',
        related='picking_id.partner_id', store=True, readonly=True,
    )
    company_id = fields.Many2one(
        'res.company', related='picking_id.company_id', store=True, readonly=True,
    )
    currency_id = fields.Many2one(
        'res.currency', related='company_id.currency_id', readonly=True,
    )
    purchase_id = fields.Many2one(
        'purchase.order', string='Orden de Compra',
        compute='_compute_purchase_id', store=True, readonly=True,
    )

    # --- Datos que se ABSORBEN de la recepción (solo lectura) ---
    origin = fields.Char(
        related='picking_id.origin', string='Documento Origen', readonly=True,
    )
    scheduled_date = fields.Datetime(
        related='picking_id.scheduled_date', string='Fecha Recepción', readonly=True,
    )
    container_no = fields.Char(
        string='Contenedor', compute='_compute_container_no',
    )
    reception_summary_html = fields.Html(
        string='Material recibido', compute='_compute_reception_summary',
        sanitize=False,
    )

    product_id = fields.Many2one(
        'product.product', string='Producto afectado', tracking=True,
        help='Opcional: producto puntual afectado por la discrepancia.',
    )
    discrepancy_type = fields.Selection([
        ('missing', 'Faltante'),
        ('damaged', 'Dañado'),
        ('wrong', 'Material distinto'),
        ('dimension', 'Dimensiones'),
        ('color', 'Color / Tono'),
        ('excess', 'Sobrante'),
        ('other', 'Otro'),
    ], string='Tipo de Discrepancia', required=True, default='damaged', tracking=True)
    description = fields.Text(string='Descripción', required=True)
    qty_affected = fields.Float(
        string='Cantidad Afectada', digits='Product Unit of Measure',
    )
    product_uom_id = fields.Many2one(
        'uom.uom', string='Unidad',
        compute='_compute_product_uom_id', store=True, readonly=False,
    )
    amount_affected = fields.Monetary(
        string='Monto Afectado', currency_field='currency_id',
    )
    state = fields.Selection([
        ('draft', 'Borrador'),
        ('open', 'Abierta'),
        ('resolved', 'Resuelta'),
        ('rejected', 'Rechazada'),
    ], string='Estado', default='open', required=True, tracking=True, copy=False)
    date = fields.Datetime(string='Fecha', default=fields.Datetime.now, tracking=True)
    reported_by = fields.Many2one(
        'res.users', string='Reportado por',
        default=lambda self: self.env.user, readonly=True,
    )
    resolution_note = fields.Text(string='Nota de Resolución')
    evidence_ids = fields.One2many(
        'purchase.discrepancy.evidence', 'discrepancy_id', string='Evidencias',
    )
    evidence_count = fields.Integer(compute='_compute_evidence_count')

    @api.depends('picking_id')
    def _compute_purchase_id(self):
        for rec in self:
            po = self.env['purchase.order']
            moves = rec.picking_id.move_ids if rec.picking_id else False
            if moves and 'purchase_line_id' in moves._fields:
                po = moves.mapped('purchase_line_id.order_id')[:1]
            rec.purchase_id = po.id if po else False

    @api.depends('picking_id')
    def _compute_container_no(self):
        for rec in self:
            rec.container_no = getattr(rec.picking_id, 'supplier_container_no', False) or ''

    def _get_reception_summary(self):
        """Resumen del material recibido en la recepción, agrupado por producto.
        Fuente única para el formulario (HTML) y el reporte PDF."""
        self.ensure_one()
        summary = {}
        picking = self.picking_id
        if not picking:
            return []
        for ml in picking.move_line_ids:
            product = ml.product_id
            if not product:
                continue
            key = product.id
            if key not in summary:
                summary[key] = {
                    'name': product.display_name,
                    'code': product.default_code or '',
                    'uom': product.uom_id.name or '',
                    'qty': 0.0,
                    'lots': [],
                }
            summary[key]['qty'] += ml.quantity or 0.0
            lot = ml.lot_id
            if lot and lot.name and lot.name not in summary[key]['lots']:
                summary[key]['lots'].append(lot.name)
        return list(summary.values())

    @api.depends('picking_id', 'picking_id.move_line_ids',
                 'picking_id.move_line_ids.quantity', 'picking_id.move_line_ids.lot_id')
    def _compute_reception_summary(self):
        for rec in self:
            rows = rec._get_reception_summary() if rec.picking_id else []
            if not rows:
                rec.reception_summary_html = Markup(
                    '<p style="color:#888;margin:0;">Sin material recibido en la recepción.</p>'
                )
                continue
            parts = [
                '<table style="width:100%;font-size:12px;border-collapse:collapse;">',
                '<thead><tr style="background:#2f2f2f;color:#fff;">'
                '<th style="color:#fff;padding:4px 6px;text-align:left;">Producto</th>'
                '<th style="color:#fff;padding:4px 6px;text-align:right;">Cantidad</th>'
                '<th style="color:#fff;padding:4px 6px;text-align:left;">UDM</th>'
                '<th style="color:#fff;padding:4px 6px;text-align:left;">Lotes</th>'
                '</tr></thead><tbody>',
            ]
            for r in rows:
                lots = ', '.join(r['lots']) if r['lots'] else '-'
                parts.append(
                    '<tr>'
                    '<td style="padding:3px 6px;border:1px solid #e5e7eb;">%s</td>'
                    '<td style="padding:3px 6px;border:1px solid #e5e7eb;text-align:right;">%.2f</td>'
                    '<td style="padding:3px 6px;border:1px solid #e5e7eb;">%s</td>'
                    '<td style="padding:3px 6px;border:1px solid #e5e7eb;">%s</td>'
                    '</tr>' % (escape(r['name']), r['qty'], escape(r['uom']), escape(lots))
                )
            parts.append('</tbody></table>')
            rec.reception_summary_html = Markup(''.join(parts))

    @api.depends('product_id')
    def _compute_product_uom_id(self):
        for rec in self:
            if rec.product_id and not rec.product_uom_id:
                rec.product_uom_id = rec.product_id.uom_id

    @api.depends('evidence_ids')
    def _compute_evidence_count(self):
        for rec in self:
            rec.evidence_count = len(rec.evidence_ids)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('Nuevo')) == _('Nuevo'):
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'purchase.discrepancy') or _('Nuevo')
        return super().create(vals_list)

    def action_set_open(self):
        self.write({'state': 'open'})

    def action_set_resolved(self):
        self.write({'state': 'resolved'})

    def action_set_rejected(self):
        self.write({'state': 'rejected'})

    def action_print_report(self):
        return self.env.ref(
            'stock_lot_packing_import.action_report_purchase_discrepancy'
        ).report_action(self)


class PurchaseDiscrepancyEvidence(models.Model):
    _name = 'purchase.discrepancy.evidence'
    _description = 'Evidencia de Discrepancia'
    _order = 'sequence, id'

    discrepancy_id = fields.Many2one(
        'purchase.discrepancy', string='Discrepancia',
        required=True, ondelete='cascade',
    )
    sequence = fields.Integer(default=10)
    name = fields.Char(string='Descripción')
    attachment = fields.Binary(string='Archivo / Imagen', required=True, attachment=True)
    filename = fields.Char(string='Nombre del archivo')
    is_image = fields.Boolean(compute='_compute_is_image', store=True)

    @api.depends('filename')
    def _compute_is_image(self):
        image_exts = ('png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp')
        for rec in self:
            ext = ''
            if rec.filename and '.' in rec.filename:
                ext = rec.filename.lower().rsplit('.', 1)[-1]
            rec.is_image = ext in image_exts
