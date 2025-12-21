# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List (Documents Spreadsheet Edition)',
    'version': '19.0.1.1.4',
    'depends': ['stock_lot_dimensions', 'documents', 'documents_spreadsheet'], # Añadido documents_spreadsheet
    'data': [
        'security/stock_lot_hold_security.xml',
        'security/ir.model.access.csv',
        'wizard/packing_list_import_wizard_views.xml',
        'wizard/worksheet_import_wizard_views.xml',
        'views/stock_picking_views.xml',
    ],
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}