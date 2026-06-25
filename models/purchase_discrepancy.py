# -*- coding: utf-8 -*-
from odoo import models, fields, api, _


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

    # --- Datos absorbidos de la recepción (solo lectura) ---
    origin = fields.Char(
        related='picking_id.origin', string='Documento Origen', readonly=True,
    )
    scheduled_date = fields.Datetime(
        related='picking_id.scheduled_date', string='Fecha Recepción', readonly=True,
    )
    container_no = fields.Char(
        string='Contenedor', compute='_compute_container_no',
    )

    # --- Productos afectados (multi-línea) ---
    line_ids = fields.One2many(
        'purchase.discrepancy.line', 'discrepancy_id', string='Productos afectados',
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
    amount_affected = fields.Monetary(
        string='Monto Afectado', currency_field='currency_id',
    )
    affected_product_count = fields.Integer(
        string='Productos afectados', compute='_compute_affected_count',
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

    @api.depends('line_ids.qty_affected')
    def _compute_affected_count(self):
        for rec in self:
            rec.affected_product_count = len(rec.line_ids.filtered(lambda l: l.qty_affected > 0))

    def _get_reception_products(self):
        """Productos de la recepción, con cantidad COMPRADA (de la OC), RECIBIDA
        (lo realmente recibido) y UDM. La comprada sirve de marco de referencia."""
        self.ensure_one()
        picking = self.picking_id
        if not picking:
            return []
        # Comprado por producto: suma de las líneas de OC ligadas a los movimientos.
        purchased = {}
        moves = picking.move_ids
        if moves and 'purchase_line_id' in moves._fields:
            for pl in moves.mapped('purchase_line_id'):
                if pl.product_id:
                    purchased.setdefault(pl.product_id.id, 0.0)
                    purchased[pl.product_id.id] += pl.product_qty or 0.0
        summary = {}
        for ml in picking.move_line_ids:
            product = ml.product_id
            if not product:
                continue
            if product.id not in summary:
                summary[product.id] = {
                    'product': product,
                    'qty': 0.0,
                    'purchased': purchased.get(product.id, 0.0),
                    'uom': product.uom_id,
                }
            summary[product.id]['qty'] += ml.quantity or 0.0
        return list(summary.values())

    def _build_lines_from_reception(self):
        """Comandos O2m para llenar line_ids con TODOS los productos recibidos."""
        self.ensure_one()
        commands = [(5, 0, 0)]
        for r in self._get_reception_products():
            commands.append((0, 0, {
                'product_id': r['product'].id,
                'qty_purchased': r['purchased'],
                'qty_received': r['qty'],
                'product_uom_id': r['uom'].id,
                'qty_affected': 0.0,
            }))
        return commands

    @api.onchange('picking_id')
    def _onchange_picking_id(self):
        """Al elegir la recepción, se enseñan TODOS los productos recibidos como
        líneas (cantidad afectada en 0; el usuario la captura o usa 'Afectar todo')."""
        if not self.picking_id:
            self.line_ids = [(5, 0, 0)]
            return
        self.line_ids = self._build_lines_from_reception()

    def action_load_reception(self):
        """Vuelve a cargar los productos de la recepción (reemplaza las líneas)."""
        for rec in self:
            rec.line_ids = rec._build_lines_from_reception()
        return True

    def action_affect_all(self):
        """'Seleccionar todo': la cantidad con discrepancia = la comprada, en cada línea."""
        for rec in self:
            for line in rec.line_ids:
                line.qty_affected = line.qty_purchased
        return True

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
        records = super().create(vals_list)
        # Si se creó con recepción pero sin líneas (p. ej. creación programática),
        # se cargan los productos recibidos automáticamente.
        for rec in records:
            if rec.picking_id and not rec.line_ids:
                rec.line_ids = rec._build_lines_from_reception()
        return records

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


class PurchaseDiscrepancyLine(models.Model):
    _name = 'purchase.discrepancy.line'
    _description = 'Producto Afectado por Discrepancia'
    _order = 'id'

    discrepancy_id = fields.Many2one(
        'purchase.discrepancy', string='Discrepancia',
        required=True, ondelete='cascade',
    )
    product_id = fields.Many2one('product.product', string='Producto', required=True)
    qty_purchased = fields.Float(
        string='Cantidad comprada', digits='Product Unit of Measure', readonly=True,
        help='Cantidad comprada en la orden de compra (marco de referencia).',
    )
    qty_received = fields.Float(
        string='Recibido', digits='Product Unit of Measure', readonly=True,
    )
    qty_affected = fields.Float(
        string='Cantidad con discrepancia', digits='Product Unit of Measure',
    )
    product_uom_id = fields.Many2one('uom.uom', string='UDM')


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
