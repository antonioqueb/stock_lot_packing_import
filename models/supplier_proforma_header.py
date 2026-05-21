# -*- coding: utf-8 -*-

from odoo import fields, models


class SupplierProformaHeader(models.Model):
    _inherit = 'supplier.proforma.header'

    port_origin = fields.Char(
        string='Puerto de origen',
        copy=False,
        help='Puerto global capturado en el portal del proveedor. Se aplica a los embarques salvo que se sobrescriba.',
    )
    port_destination = fields.Char(
        string='Puerto destino',
        copy=False,
        help='Puerto destino global capturado en el portal del proveedor. Se aplica a los embarques salvo que se sobrescriba.',
    )
