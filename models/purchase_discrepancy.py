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
        'res.currency', string='Moneda',
        compute='_compute_currency_id', store=True,
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
        string='Monto Afectado (total)', currency_field='currency_id',
        compute='_compute_amount_affected', store=True,
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

    @api.depends('purchase_id', 'purchase_id.currency_id', 'company_id')
    def _compute_currency_id(self):
        for rec in self:
            rec.currency_id = (
                rec.purchase_id.currency_id
                or rec.company_id.currency_id
                or self.env.company.currency_id
            )

    @api.depends('picking_id')
    def _compute_container_no(self):
        for rec in self:
            rec.container_no = getattr(rec.picking_id, 'supplier_container_no', False) or ''

    @api.depends('line_ids.amount_affected')
    def _compute_amount_affected(self):
        for rec in self:
            rec.amount_affected = sum(rec.line_ids.mapped('amount_affected'))

    @api.depends('line_ids.qty_affected')
    def _compute_affected_count(self):
        for rec in self:
            rec.affected_product_count = len(rec.line_ids.filtered(lambda l: l.qty_affected > 0))

    @api.depends('evidence_ids')
    def _compute_evidence_count(self):
        for rec in self:
            rec.evidence_count = len(rec.evidence_ids)

    def _build_lines_from_reception(self):
        """Comandos O2m: una línea por cada producto recibido en la recepción.
        Las cantidades comprada/recibida y el costo los calcula la propia línea."""
        self.ensure_one()
        commands = [(5, 0, 0)]
        seen = set()
        picking = self.picking_id
        if not picking:
            return commands
        for ml in picking.move_line_ids:
            product = ml.product_id
            if not product or product.id in seen:
                continue
            seen.add(product.id)
            commands.append((0, 0, {
                'product_id': product.id,
                'product_uom_id': product.uom_id.id,
                'qty_affected': 0.0,
            }))
        return commands

    @api.onchange('picking_id')
    def _onchange_picking_id(self):
        """Al elegir la recepción se enseñan TODOS los productos recibidos."""
        if not self.picking_id:
            self.line_ids = [(5, 0, 0)]
            return
        self.line_ids = self._build_lines_from_reception()

    def action_load_reception(self):
        for rec in self:
            rec.line_ids = rec._build_lines_from_reception()
        return True

    def action_affect_all(self):
        """'Seleccionar todo': la cantidad con discrepancia = la comprada."""
        for rec in self:
            for line in rec.line_ids:
                line.qty_affected = line.qty_purchased
        return True

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('Nuevo')) == _('Nuevo'):
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'purchase.discrepancy') or _('Nuevo')
        records = super().create(vals_list)
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
    currency_id = fields.Many2one(
        'res.currency', related='discrepancy_id.currency_id', store=True, readonly=True,
    )
    product_id = fields.Many2one('product.product', string='Producto', required=True)
    product_uom_id = fields.Many2one('uom.uom', string='UDM')

    # Cantidades y costo: COMPUTADAS ALMACENADAS desde el producto + la recepción,
    # para que nunca se pierdan al guardar/imprimir (no dependen de onchange).
    qty_purchased = fields.Float(
        string='Cantidad comprada', digits='Product Unit of Measure',
        compute='_compute_line_data', store=True, readonly=True,
        help='Cantidad comprada en la orden de compra (marco de referencia).',
    )
    qty_received = fields.Float(
        string='Recibido', digits='Product Unit of Measure',
        compute='_compute_line_data', store=True, readonly=True,
    )
    unit_cost = fields.Monetary(
        string='Costo de compra', currency_field='currency_id',
        compute='_compute_line_data', store=True, readonly=True,
        help='Costo unitario de compra (precio de la línea de OC; si no hay, costo estándar).',
    )
    qty_affected = fields.Float(
        string='Cantidad con discrepancia', digits='Product Unit of Measure',
    )
    amount_affected = fields.Monetary(
        string='Monto afectado', currency_field='currency_id',
        compute='_compute_line_data', store=True, readonly=True,
    )

    @api.depends('product_id', 'qty_affected',
                 'discrepancy_id.picking_id', 'discrepancy_id.purchase_id')
    def _compute_line_data(self):
        for line in self:
            picking = line.discrepancy_id.picking_id
            product = line.product_id
            purchased = received = cost = 0.0
            if picking and product:
                moves = picking.move_ids.filtered(lambda m: m.product_id == product)
                pls = moves.mapped('purchase_line_id') if 'purchase_line_id' in moves._fields else moves.browse()
                for pl in pls:
                    purchased += pl.product_qty or 0.0
                if pls:
                    cost = pls[0].price_unit or 0.0
                if not cost:
                    cost = product.standard_price or 0.0
                for ml in picking.move_line_ids.filtered(lambda m: m.product_id == product):
                    received += ml.quantity or 0.0
            line.qty_purchased = purchased
            line.qty_received = received
            line.unit_cost = cost
            line.amount_affected = (line.qty_affected or 0.0) * cost


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
