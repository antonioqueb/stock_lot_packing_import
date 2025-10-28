# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List',
    'version': '18.0.1.0.0',
    'category': 'Inventory/Inventory',
    'summary': 'Importación Excel de lotes con numeración automática',
    'author': 'Alphaqueb Consulting',
    'website': 'https://alphaqueb.com',
    'depends': ['stock_lot_dimensions'],
    'data': [
        'security/ir.model.access.csv',
        'wizard/packing_list_import_wizard_views.xml',
        'wizard/worksheet_import_wizard_views.xml',
        'views/stock_picking_views.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}
