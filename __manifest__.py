# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List & Portal Proveedor',
    'version': '19.0.6.39.0',
    'depends': ['stock', 'purchase', 'stock_lot_dimensions', 'documents', 'documents_spreadsheet', 'web', 'product_origin_names'],
    'author': 'Alphaqueb Consulting',
    'category': 'Inventory/Inventory',
    'data': [
        'security/stock_lot_hold_security.xml',
        'security/ir.model.access.csv',
        'data/purchase_discrepancy_data.xml',
        'wizard/packing_list_import_wizard_views.xml',
        'wizard/worksheet_import_wizard_views.xml',
        'wizard/supplier_link_wizard_views.xml',
        'views/purchase_order_views.xml',
        'views/stock_picking_views.xml',
        'views/supplier_portal_templates.xml',
        'reports/purchase_discrepancy_report.xml',
        'views/purchase_discrepancy_views.xml',
    ],
    'assets': {
        'web.assets_frontend': [
            # Portal React exacto compilado desde los archivos JSX adjuntos.
            # No se cargan los JS/SCSS legacy del portal para evitar doble render y conflictos visuales.
            'stock_lot_packing_import/static/src/css/portal_react_exact.css',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
