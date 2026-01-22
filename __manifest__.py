# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List & Portal Proveedor',
    'version': '19.0.2.1.0',
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
        # JS/CSS del portal (website)
        'web.assets_frontend': [
            'stock_lot_packing_import/static/src/scss/supplier_portal.scss',
            'stock_lot_packing_import/static/src/js/supplier_portal.js',
        ],
        # Templates OWL/QWeb (CRÍTICO para evitar Missing template)
        'web.assets_qweb': [
            'stock_lot_packing_import/static/src/xml/supplier_portal.xml',
        ],
    },

    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
