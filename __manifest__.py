# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List (Documents Edition)',
    'version': '19.0.1.1.3',
    'category': 'Inventory/Inventory',
    'summary': 'Uso de Odoo Documents Spreadsheet para Packing List',
    'author': 'Alphaqueb Consulting',
    'website': 'https://alphaqueb.com',
    'depends': ['stock_lot_dimensions', 'documents'], # Dependencia correcta según tu sistema
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