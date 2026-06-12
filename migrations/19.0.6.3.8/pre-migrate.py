# -*- coding: utf-8 -*-
"""Deduplica supplier.shipment.block.image antes de aplicar el índice único.

La restricción ``_supplier_block_image_unique`` (UNIQUE(shipment_id, block_name,
product_id)) no puede crearse mientras existan registros duplicados para una
misma combinación, p.ej. (shipment_id, block_name, product_id) = (7, 270735, 8551).

Este script se ejecuta en fase ``pre`` —antes de que Odoo cree el índice único—
y conserva la fila con id más alto (la foto subida más recientemente) de cada
grupo duplicado, eliminando las anteriores.
"""

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return

    # ¿Existe ya la tabla? (defensivo ante instalaciones nuevas)
    cr.execute("SELECT to_regclass('public.supplier_shipment_block_image')")
    if not cr.fetchone()[0]:
        return

    # Reporta los grupos duplicados antes de limpiar (para trazabilidad).
    cr.execute(
        """
        SELECT shipment_id, block_name, product_id, COUNT(*) AS total
          FROM supplier_shipment_block_image
         GROUP BY shipment_id, block_name, product_id
        HAVING COUNT(*) > 1
        """
    )
    duplicates = cr.fetchall()
    if not duplicates:
        return

    total_extra = sum(row[3] - 1 for row in duplicates)
    _logger.warning(
        "stock_lot_packing_import: %s combinaciones duplicadas en "
        "supplier_shipment_block_image; se eliminarán %s filas sobrantes "
        "para poder crear el índice único.",
        len(duplicates), total_extra,
    )

    # Conserva el id más alto de cada grupo, borra el resto.
    cr.execute(
        """
        DELETE FROM supplier_shipment_block_image a
              USING supplier_shipment_block_image b
         WHERE a.shipment_id = b.shipment_id
           AND a.block_name  = b.block_name
           AND a.product_id  = b.product_id
           AND a.id < b.id
        """
    )
    _logger.warning(
        "stock_lot_packing_import: %s filas duplicadas eliminadas de "
        "supplier_shipment_block_image.",
        cr.rowcount,
    )
