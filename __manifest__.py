# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List (Spreadsheet Edition)',
    'version': '19.0.1.1.1', # Incrementamos versión
    'category': 'Inventory/Inventory',
    'summary': 'Uso de Odoo Spreadsheet para Packing List y Excel para Worksheet',
    'author': 'Alphaqueb Consulting',
    'website': 'https://alphaqueb.com',
    # Cambiamos 'spreadsheet_edition' por 'spreadsheet' para asegurar que el modelo exista
    'depends': ['stock_lot_dimensions', 'spreadsheet', 'spreadsheet_edition'], 
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