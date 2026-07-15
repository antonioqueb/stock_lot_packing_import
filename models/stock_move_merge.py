# -*- coding: utf-8 -*-
"""Recepciones con UNA línea por producto.

Cuando la OC tiene el mismo producto en varias líneas (precios distintos),
Odoo genera un stock.move por línea de compra porque `purchase_line_id` está
en los campos "distintivos" del merge nativo. Operativamente la recepción es
UNA sola: se recibe el producto completo, no por precio.

Al quitar `purchase_line_id` del criterio, `_merge_moves` (que corre en la
confirmación de la OC) fusiona los moves del mismo producto y la recepción
nace con una línea por producto con la cantidad SUMADA — independiente del
portal del proveedor.

Consecuencias asumidas (decisión de negocio):
- El move fusionado queda ligado a UNA línea de compra; el "recibido" nativo
  se acumula ahí. El costo por línea vive en la OC (facturación por pedido /
  PL declarado, no por recibido).
"""
from odoo import models


class StockMoveMergeByProduct(models.Model):
    _inherit = 'stock.move'

    def _prepare_merge_moves_distinct_fields(self):
        distinct_fields = super()._prepare_merge_moves_distinct_fields()
        return [
            f for f in distinct_fields
            if f not in ('purchase_line_id', 'created_purchase_line_ids')
        ]
