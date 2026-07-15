# -*- coding: utf-8 -*-
"""Elimina la versión OBSOLETA de la vista PI de la OC guardada en la base.

La vista view_purchase_order_form_pi (arch viejo) agregaba supplier_pi_number
al formulario de purchase.order. Ese campo ya no existe (la PI vive en
partner_ref), y como la vista vieja sigue activa en ir_ui_view, la validación
del formulario combinado truena ANTES de que el update recargue el arch nuevo.
Se borra aquí y el update la recrea limpia desde el XML."""


def migrate(cr, version):
    cr.execute("""
        DELETE FROM ir_ui_view v
         USING ir_model_data d
         WHERE d.model = 'ir.ui.view'
           AND d.res_id = v.id
           AND d.module = 'stock_lot_packing_import'
           AND d.name = 'view_purchase_order_form_pi'
    """)
    cr.execute("""
        DELETE FROM ir_model_data
         WHERE module = 'stock_lot_packing_import'
           AND name = 'view_purchase_order_form_pi'
    """)
    # Cinturón extra: cualquier vista de purchase.order que aún referencie el
    # campo eliminado (p. ej. personalizaciones manuales) se desactiva para no
    # bloquear el registro.
    cr.execute("""
        UPDATE ir_ui_view
           SET active = false
         WHERE model = 'purchase.order'
           AND arch_db::text LIKE '%supplier_pi_number%'
    """)
