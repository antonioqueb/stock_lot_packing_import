# -*- coding: utf-8 -*-
"""La unicidad del enlace pasa de UNIQUE(purchase_id) a
UNIQUE(purchase_id, cargo_invoice_id): una nueva factura de carga para la
misma PO genera un enlace nuevo (embarques parciales)."""


def migrate(cr, version):
    for name in (
        'stock_picking_supplier_access_supplier_access_unique_purchase',
        'stock_picking_supplier_access__supplier_access_unique_purchase',
    ):
        cr.execute(
            'ALTER TABLE stock_picking_supplier_access '
            'DROP CONSTRAINT IF EXISTS "%s"' % name
        )
