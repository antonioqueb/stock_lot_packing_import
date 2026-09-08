# -*- coding: utf-8 -*-
"""Limpia los moves-delta CANCELADOS que purchase_stock dejó en las
recepciones del portal (un move por cada autoguardado del PL que movía
product_qty en la OC). Solo se borran los que:
  - están cancelados y NO tienen move lines (nada de inventario detrás),
  - viven en una recepción de compra ligada a un embarque del portal,
  - duplican un producto que SIGUE presente en esa recepción en otro move
    no cancelado (jamás se borra el único rastro de un producto).
"""
import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    Move = env['stock.move']
    if 'supplier_shipment_id' not in env['stock.picking']._fields:
        return
    candidates = Move.search([
        ('state', '=', 'cancel'),
        ('move_line_ids', '=', False),
        ('picking_id.picking_type_code', '=', 'incoming'),
        ('picking_id.supplier_shipment_id', '!=', False),
    ])
    to_delete = Move.browse()
    for move in candidates:
        alive = move.picking_id.move_ids.filtered(
            lambda m: m.id != move.id
            and m.product_id == move.product_id
            and m.state != 'cancel')
        if alive:
            to_delete |= move
    if not to_delete:
        _logger.info('[PL_DELTA_CLEANUP] Sin moves cancelados duplicados.')
        return
    by_picking = {}
    for move in to_delete:
        by_picking.setdefault(move.picking_id.name, 0)
        by_picking[move.picking_id.name] += 1
    _logger.info(
        '[PL_DELTA_CLEANUP] Borrando %s moves cancelados duplicados: %s',
        len(to_delete), by_picking)
    to_delete.unlink()
