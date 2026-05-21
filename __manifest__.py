# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List & Portal Proveedor',
    'version': '19.0.6.1.0',
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
            # ── SCSS: Variables PRIMERO ───────────────────────────────────────
            'stock_lot_packing_import/static/src/scss/_tokens.scss',

            # ── SCSS: Componentes legacy existentes ───────────────────────────
            'stock_lot_packing_import/static/src/scss/_base.scss',
            'stock_lot_packing_import/static/src/scss/_header.scss',
            'stock_lot_packing_import/static/src/scss/_container.scss',
            'stock_lot_packing_import/static/src/scss/_cards.scss',
            'stock_lot_packing_import/static/src/scss/_badges.scss',
            'stock_lot_packing_import/static/src/scss/_buttons.scss',
            'stock_lot_packing_import/static/src/scss/_shipments.scss',
            'stock_lot_packing_import/static/src/scss/_tabs.scss',
            'stock_lot_packing_import/static/src/scss/_sub_items.scss',
            'stock_lot_packing_import/static/src/scss/_product_sections.scss',
            'stock_lot_packing_import/static/src/scss/_inputs.scss',
            'stock_lot_packing_import/static/src/scss/_packing_rows.scss',
            'stock_lot_packing_import/static/src/scss/_photos.scss',
            'stock_lot_packing_import/static/src/scss/_footer.scss',
            'stock_lot_packing_import/static/src/scss/_progress.scss',
            'stock_lot_packing_import/static/src/scss/_toast.scss',
            'stock_lot_packing_import/static/src/scss/_loading.scss',
            'stock_lot_packing_import/static/src/scss/_autosave.scss',
            'stock_lot_packing_import/static/src/scss/_date_input.scss',
            'stock_lot_packing_import/static/src/scss/_modal.scss',
            'stock_lot_packing_import/static/src/scss/_info_hint.scss',

            # PORTAL-REDESIGN-001:
            # Capa visual final para replicar la nueva estructura tipo app:
            # header fijo, sidebar, guía contextual, cards, wizard y tabla de packing.
            'stock_lot_packing_import/static/src/scss/_portal_modern.scss',

            # ── JS Portal legacy existente ────────────────────────────────────
            'stock_lot_packing_import/static/src/js/supplier_portal/namespace.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/translations.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/utils.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/packing_rows.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/documents.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/shipment_tabs.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/portal_core.js',

            # PORTAL-REDESIGN-002:
            # Nueva aplicación frontend. Mantiene los mismos endpoints JSON-RPC.
            'stock_lot_packing_import/static/src/js/supplier_portal/modern_portal.js',
            'stock_lot_packing_import/static/src/js/supplier_portal/main.js',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
