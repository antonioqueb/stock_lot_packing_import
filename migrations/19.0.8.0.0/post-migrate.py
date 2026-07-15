# -*- coding: utf-8 -*-
"""La PI del proveedor pasa a vivir en el campo NATIVO partner_ref
(Referencia de proveedor). Se rescatan los valores capturados en el campo
transitorio supplier_pi_number y se eliminan sus columnas."""


def migrate(cr, version):
    cr.execute("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_order'
          AND column_name = 'supplier_pi_number'
    """)
    if cr.fetchone():
        cr.execute("""
            UPDATE purchase_order
               SET partner_ref = supplier_pi_number
             WHERE (partner_ref IS NULL OR partner_ref = '')
               AND supplier_pi_number IS NOT NULL
               AND supplier_pi_number != ''
        """)
        cr.execute("ALTER TABLE purchase_order DROP COLUMN supplier_pi_number")

    cr.execute("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_order'
          AND column_name = 'pi_confirmed_date'
    """)
    if cr.fetchone():
        cr.execute("ALTER TABLE purchase_order DROP COLUMN pi_confirmed_date")
