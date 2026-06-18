# -*- coding: utf-8 -*-
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    """Extiende la vigencia de TODOS los links del portal del proveedor a al
    menos 1 año desde ahora.

    El default y la creación ya usan 365 días, pero los links generados antes de
    ese cambio conservaban una vigencia más corta. Para compras internacionales
    el proveedor necesita más tiempo, así que se renuevan todos a 1 año.
    """
    cr.execute(
        """
        UPDATE stock_picking_supplier_access
           SET expiration_date = (now() at time zone 'UTC') + interval '365 days'
         WHERE expiration_date IS NULL
            OR expiration_date < (now() at time zone 'UTC') + interval '365 days'
        """
    )
    _logger.info(
        "[stock_lot_packing_import] Vigencia de %s link(s) del portal extendida a 1 año.",
        cr.rowcount,
    )
