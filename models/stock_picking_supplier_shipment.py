# -*- coding: utf-8 -*-
from odoo import models, fields


class StockPickingSupplierShipment(models.Model):
    _inherit = 'stock.picking'

    supplier_shipment_id = fields.Many2one(
        'supplier.shipment',
        string='Embarque proveedor',
        copy=False,
        index=True,
        ondelete='set null',
        help='Relaciona esta recepción con un embarque específico capturado en el portal del proveedor.',
    )