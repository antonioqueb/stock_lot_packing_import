# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List & Portal Proveedor',
    'version': '19.0.5.0.0',
    'depends': ['stock', 'purchase', 'stock_lot_dimensions', 'documents', 'documents_spreadsheet', 'web'],
    'author': 'Alphaqueb Consulting',
    'category': 'Inventory/Inventory',
    'data': [
        'security/stock_lot_hold_security.xml',
        'security/ir.model.access.csv',
        'wizard/packing_list_import_wizard_views.xml',
        'wizard/worksheet_import_wizard_views.xml',
        'wizard/supplier_link_wizard_views.xml',
        'views/purchase_order_views.xml',
        'views/stock_picking_views.xml',
        'views/supplier_portal_templates.xml',
    ],
    'assets': {
        'web.assets_frontend': [
            'stock_lot_packing_import/static/src/scss/supplier_portal.scss',

            'stock_lot_packing_import/static/src/js/supplier_portal/namespace.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/translations.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/utils.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/packing_rows.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/documents.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/shipment_tabs.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/portal_core.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/main.js',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}