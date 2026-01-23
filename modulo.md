## ./__init__.py
```py
# -*- coding: utf-8 -*-
from . import models
from . import wizard
from . import controllers
```

## ./__manifest__.py
```py
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
        'web.assets_frontend': [
            'stock_lot_packing_import/static/src/scss/supplier_portal.scss',
            # ELIMINADO: 'stock_lot_packing_import/static/src/xml/supplier_portal.xml',
            'stock_lot_packing_import/static/src/js/supplier_portal.js',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}```

## ./controllers/__init__.py
```py
# -*- coding: utf-8 -*-
from . import supplier_portal```

## ./controllers/supplier_portal.py
```py
# -*- coding: utf-8 -*-
import json
from odoo import http
from odoo.http import request
from markupsafe import Markup
import logging

_logger = logging.getLogger(__name__)

class SupplierPortalController(http.Controller):

    def _get_picking_moves_for_portal(self, picking):
        moves = False
        if hasattr(picking, "move_ids_without_package"):
            moves = picking.move_ids_without_package
        if not moves:
            moves = picking.move_ids
        return moves.filtered(lambda m: m.state != "cancel")

    def _build_products_payload(self, picking):
        moves = self._get_picking_moves_for_portal(picking)
        bucket = {}
        for move in moves:
            product = move.product_id
            if not product: continue
            pid = product.id
            if pid not in bucket:
                bucket[pid] = {
                    "id": pid,
                    "name": product.display_name or product.name,
                    "code": product.default_code or "",
                    "qty_ordered": 0.0,
                    "uom": (move.product_uom and move.product_uom.name) or "",
                }
            bucket[pid]["qty_ordered"] += (move.product_uom_qty or 0.0)
        products = list(bucket.values())
        products.sort(key=lambda x: (x.get("name") or "").lower())
        return products

    @http.route('/supplier/pl/<string:token>', type='http', auth='public', website=True, sitemap=False)
    def view_supplier_portal(self, token, **kwargs):
        access = request.env['stock.picking.supplier.access'].sudo().search([('access_token', '=', token)], limit=1)

        if not access: return request.render('stock_lot_packing_import.portal_not_found')
        if access.is_expired: return request.render('stock_lot_packing_import.portal_expired')

        if access.purchase_id:
            po = access.purchase_id
            pickings = po.picking_ids.filtered(lambda p: p.picking_type_code == 'incoming' and p.state not in ('done', 'cancel'))
            if pickings:
                target_picking = pickings.sorted(key=lambda p: p.id, reverse=True)[0]
                if access.picking_id.id != target_picking.id:
                    access.write({'picking_id': target_picking.id})

        picking = access.picking_id
        if not picking: return request.render('stock_lot_packing_import.portal_not_found')

        products = self._build_products_payload(picking)
        if not products: products = []

        # --- 1. DATOS DE FILAS (SPREADSHEET) ---
        existing_rows = []
        if picking.spreadsheet_id:
            try:
                existing_rows = picking.sudo().get_packing_list_data_for_portal()
            except Exception as e:
                _logger.error(f"Error recuperando datos del spreadsheet: {e}")
                existing_rows = []

        # --- 2. DATOS DE CABECERA (OBTENER DE ODOO) ---
        # Estos datos se pre-cargan desde lo que ya tenga guardado el Picking
        header_data = {
            'invoice_number': picking.supplier_invoice_number or "",
            'shipment_date': str(picking.supplier_shipment_date) if picking.supplier_shipment_date else "",
            'proforma_number': picking.supplier_proforma_number or "",
            'bl_number': picking.supplier_bl_number or "",
            'origin': picking.supplier_origin or "",
            'destination': picking.supplier_destination or "",
            'country_origin': picking.supplier_country_origin or "",
            'vessel': picking.supplier_vessel or "",
            'incoterm_payment': picking.supplier_incoterm_payment or "",
            'merchandise_desc': picking.supplier_merchandise_desc or "",
            'container_no': picking.supplier_container_no or "",
            'seal_no': picking.supplier_seal_no or "",
            'container_type': picking.supplier_container_type or "",
            'total_packages': picking.supplier_total_packages or 0,
            'gross_weight': picking.supplier_gross_weight or 0.0,
            'volume': picking.supplier_volume or 0.0,
            'status': picking.supplier_status or ""
        }

        full_data = {
            'products': products,
            'existing_rows': existing_rows,
            'header': header_data, # Enviamos al JS lo que hay en la base de datos
            'token': token,
            'poName': access.purchase_id.name if access.purchase_id else (picking.origin or ""),
            'pickingName': picking.name or "",
            'companyName': picking.company_id.name or ""
        }

        json_payload = json.dumps(full_data, ensure_ascii=False)

        values = {
            'picking': picking,
            'portal_json': Markup(json_payload),
        }
        return request.render('stock_lot_packing_import.supplier_portal_view', values)

    @http.route('/supplier/pl/submit', type='json', auth='public', csrf=False)
    def submit_pl_data(self, token, rows, header=None):
        access = request.env['stock.picking.supplier.access'].sudo().search([('access_token', '=', token)], limit=1)
        if not access or access.is_expired:
            return {'success': False, 'message': 'Token inválido.'}
        
        picking = access.picking_id
        if not picking: return {'success': False, 'message': 'Picking no encontrado.'}
        
        if picking.state in ('done', 'cancel'): 
            return {'success': False, 'message': 'La recepción ya fue procesada y no se puede modificar.'}

        try:
            # Guardamos tanto las filas (Spreadsheet) como la cabecera (Picking fields)
            picking.sudo().update_packing_list_from_portal(rows, header_data=header)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'message': str(e)}```

## ./models/__init__.py
```py
# -*- coding: utf-8 -*-
from . import stock_picking
from . import purchase_order
from . import supplier_access```

## ./models/purchase_order.py
```py
# -*- coding: utf-8 -*-
from datetime import timedelta
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    supplier_access_ids = fields.One2many(
        'stock.picking.supplier.access', 'purchase_id', string="Links Proveedor"
    )

    def _get_target_incoming_picking_for_supplier_portal(self):
        """Devuelve la recepción 'vigente' para el portal:
        - Incoming
        - No done/cancel
        - Preferimos la más reciente (backorder actual suele ser el último).
        """
        self.ensure_one()

        pickings = self.picking_ids.filtered(
            lambda p: p.picking_type_code == 'incoming' and p.state not in ('done', 'cancel')
        )
        if not pickings:
            return False

        # Elegimos el más reciente como “vigente”
        return pickings.sorted(key=lambda p: p.id, reverse=True)[0]

    def _get_or_create_supplier_access(self, target_picking):
        """Garantiza 1 acceso por PO (token estable).
        - Si ya existe, NO cambia token.
        - Actualiza picking_id a la recepción vigente.
        - Renueva expiración (opcional: aquí se renueva siempre).
        """
        self.ensure_one()

        access = self.env['stock.picking.supplier.access'].sudo().search(
            [('purchase_id', '=', self.id)], limit=1
        )

        vals_update = {}
        if target_picking and (not access or access.picking_id.id != target_picking.id):
            vals_update['picking_id'] = target_picking.id

        # Mantener token SIEMPRE. Renovamos vigencia para que “generar de nuevo” no cambie URL.
        vals_update['expiration_date'] = fields.Datetime.now() + timedelta(days=15)

        if access:
            if vals_update:
                access.write(vals_update)
            return access

        # Si no existe, crearlo por primera vez
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        return self.env['stock.picking.supplier.access'].sudo().create({
            'purchase_id': self.id,
            'picking_id': target_picking.id,
            'expiration_date': vals_update['expiration_date'],
        })

    def action_open_supplier_link_wizard(self):
        """Abre wizard para copiar el link (y de paso asegura el access único por PO)."""
        self.ensure_one()

        if self.state not in ['purchase', 'done']:
            raise UserError(_("Debe confirmar la Orden de Compra antes de enviar el link al proveedor."))

        target_picking = self._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        # Garantiza token estable
        self._get_or_create_supplier_access(target_picking)

        return {
            'type': 'ir.actions.act_window',
            'name': _('Link Portal Proveedor'),
            'res_model': 'purchase.supplier.portal.link.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_purchase_id': self.id,
            }
        }
```

## ./models/stock_picking.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import io
import base64
import logging
import json
import re

_logger = logging.getLogger(__name__)

class StockPicking(models.Model):
    _inherit = 'stock.picking'
    
    # --- Campos de Archivos y Estado (Existentes) ---
    packing_list_file = fields.Binary(string='Packing List (Archivo)', attachment=True, copy=False)
    packing_list_filename = fields.Char(string='Nombre del archivo', copy=False)
    spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet Packing List', copy=False)
    has_packing_list = fields.Boolean(string='Tiene Packing List', compute='_compute_has_packing_list', store=True)
    packing_list_imported = fields.Boolean(string='Packing List Importado', default=False, copy=False)
    
    ws_spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet Worksheet', copy=False)
    worksheet_file = fields.Binary(string='Worksheet Exportado', attachment=True, copy=False)
    worksheet_filename = fields.Char(string='Nombre del Worksheet', copy=False)
    worksheet_imported = fields.Boolean(string='Worksheet Importado', default=False, copy=False)

    supplier_access_ids = fields.One2many('stock.picking.supplier.access', 'picking_id', string="Links Proveedor")

    # --- NUEVOS CAMPOS: INFORMACIÓN DE EMBARQUE (PORTAL PROVEEDOR) ---
    supplier_invoice_number = fields.Char(string="No. de factura")
    supplier_shipment_date = fields.Date(string="Fecha de embarque")
    supplier_proforma_number = fields.Char(string="No. de Proforma (PI)")
    supplier_bl_number = fields.Char(string="No. de Conocimiento de Embarque (B/L)")
    supplier_origin = fields.Char(string="Origen (puerto/ciudad)")
    supplier_destination = fields.Char(string="Destino (puerto/ciudad)")
    supplier_country_origin = fields.Char(string="País de origen de la mercancía")
    supplier_vessel = fields.Char(string="Buque")
    supplier_incoterm_payment = fields.Char(string="Incoterm y forma de pago")
    supplier_merchandise_desc = fields.Text(string="Descripción de mercancía")
    supplier_container_no = fields.Char(string="No. de contenedor")
    supplier_seal_no = fields.Char(string="No. de sello")
    supplier_container_type = fields.Char(string="Tipo de contenedor")
    supplier_total_packages = fields.Integer(string="Total de paquetes")
    supplier_gross_weight = fields.Float(string="Peso bruto (kg)")
    supplier_volume = fields.Float(string="Volumen (m³)")
    supplier_status = fields.Char(string="Estatus (en stock)")
    
    @api.depends('packing_list_file', 'spreadsheet_id', 'supplier_access_ids')
    def _compute_has_packing_list(self):
        for rec in self:
            rec.has_packing_list = bool(rec.packing_list_file or rec.spreadsheet_id or rec.supplier_access_ids)

    # -------------------------------------------------------------------------
    #  LOGICA DE SPREADSHEET (Lectura/Escritura Portal)
    # -------------------------------------------------------------------------

    def get_packing_list_data_for_portal(self):
        """
        Lee el Spreadsheet actual y devuelve la lista de filas
        formateada para el JS del Portal.
        """
        self.ensure_one()
        rows = []
        
        if not self.spreadsheet_id or not self.spreadsheet_id.spreadsheet_data:
            return rows

        try:
            raw_data = self.spreadsheet_id.spreadsheet_data
            data = json.loads(raw_data.decode('utf-8') if isinstance(raw_data, bytes) else raw_data)
        except Exception as e:
            _logger.warning(f"Error leyendo JSON del spreadsheet: {e}")
            return rows

        sheets = data.get('sheets', [])
        
        for sheet in sheets:
            cells = sheet.get('cells', {})
            b1_val = cells.get("B1", {}).get("content", "")
            
            if not b1_val: continue

            p_ref = str(b1_val).split('(')[0].strip()
            product = self.env['product.product'].search([
                '|', ('name', 'ilike', p_ref), ('default_code', 'ilike', p_ref)
            ], limit=1)
            
            if not product: continue

            row_idx = 3
            while True:
                idx_str = str(row_idx + 1)
                
                b_cell = cells.get(f"B{idx_str}", {})
                if not b_cell or not b_cell.get("content"):
                    if not cells.get(f"C{idx_str}", {}).get("content"):
                        found_next = False
                        for lookahead in range(1, 4):
                            if cells.get(f"B{row_idx + 1 + lookahead}", {}).get("content"):
                                found_next = True
                                break
                        if not found_next:
                            break
                        else:
                            row_idx += 1
                            continue

                def get_val(col, type_cast=str):
                    val = cells.get(f"{col}{idx_str}", {}).get("content", "")
                    if type_cast == float:
                        try: 
                            val_str = str(val).replace(',', '.')
                            return float(val_str)
                        except: 
                            return 0.0
                    return str(val).strip()

                alto = get_val("B", float)
                ancho = get_val("C", float)

                if alto > 0 and ancho > 0:
                    rows.append({
                        'product_id': product.id,
                        'grosor': get_val("A", float),
                        'alto': alto,
                        'ancho': ancho,
                        'color': get_val("D"),
                        'bloque': get_val("E"),
                        'contenedor': get_val("J"),
                        'tipo': get_val("G") or 'placa'
                    })
                
                row_idx += 1
                if row_idx > 2000: break

        return rows

    def update_packing_list_from_portal(self, rows, header_data=None):
        """
        1. Escribe filas en Spreadsheet.
        2. Guarda datos de cabecera en el modelo Picking.
        """
        self.ensure_one()
        
        # --- A. GUARDAR CABECERA EN ODOO ---
        if header_data:
            vals = {
                'supplier_invoice_number': header_data.get('invoice_number'),
                'supplier_shipment_date': header_data.get('shipment_date') or False,
                'supplier_proforma_number': header_data.get('proforma_number'),
                'supplier_bl_number': header_data.get('bl_number'),
                'supplier_origin': header_data.get('origin'),
                'supplier_destination': header_data.get('destination'),
                'supplier_country_origin': header_data.get('country_origin'),
                'supplier_vessel': header_data.get('vessel'),
                'supplier_incoterm_payment': header_data.get('incoterm_payment'),
                'supplier_merchandise_desc': header_data.get('merchandise_desc'),
                'supplier_container_no': header_data.get('container_no'),
                'supplier_seal_no': header_data.get('seal_no'),
                'supplier_container_type': header_data.get('container_type'),
                'supplier_total_packages': int(header_data.get('total_packages') or 0),
                'supplier_gross_weight': float(header_data.get('gross_weight') or 0.0),
                'supplier_volume': float(header_data.get('volume') or 0.0),
                'supplier_status': header_data.get('status'),
            }
            self.write(vals)

        # --- B. ACTUALIZAR SPREADSHEET (FILAS) ---
        if not rows:
            return True

        if not self.spreadsheet_id:
            self.action_open_packing_list_spreadsheet()
        
        doc = self.spreadsheet_id
        if not doc.spreadsheet_data:
            return True

        try:
            raw_data = doc.spreadsheet_data
            data = json.loads(raw_data.decode('utf-8') if isinstance(raw_data, bytes) else raw_data)
        except Exception as e:
            raise UserError(f"Error al leer el Spreadsheet: {e}")

        product_sheet_map = {} 
        
        sheets = data.get('sheets', [])
        for sheet in sheets:
            cells = sheet.get('cells', {})
            b1_val = cells.get("B1", {}).get("content", "")
            
            if b1_val:
                p_ref = str(b1_val).split('(')[0].strip()
                product = self.env['product.product'].search([
                    '|', ('name', 'ilike', p_ref), ('default_code', 'ilike', p_ref)
                ], limit=1)
                
                if product:
                    product_sheet_map[product.id] = sheet
                    
                    keys_to_remove = []
                    for key in list(cells.keys()):
                        match = re.match(r'^([A-Z]+)(\d+)$', key)
                        if match:
                            row_num = int(match.group(2))
                            if row_num >= 4:
                                keys_to_remove.append(key)
                    
                    for k in keys_to_remove:
                        del cells[k]

        rows_by_product = {}
        for row in rows:
            try:
                pid = int(row.get('product_id'))
                if pid not in rows_by_product:
                    rows_by_product[pid] = []
                rows_by_product[pid].append(row)
            except: continue

        for pid, prod_rows in rows_by_product.items():
            sheet = product_sheet_map.get(pid)
            if not sheet: continue

            current_row = 4
            
            for row in prod_rows:
                def set_c(col_letter, val):
                    if val is not None:
                        if 'cells' not in sheet: sheet['cells'] = {}
                        sheet['cells'][f"{col_letter}{current_row}"] = {"content": str(val)}

                set_c("A", row.get('grosor', ''))
                set_c("B", row.get('alto', ''))
                set_c("C", row.get('ancho', ''))
                set_c("D", row.get('color', ''))
                set_c("E", row.get('bloque', ''))
                set_c("G", row.get('tipo', 'placa'))
                set_c("J", row.get('contenedor', ''))
                set_c("L", "Actualizado Portal")
                
                current_row += 1

        new_json = json.dumps(data)
        doc.write({
            'spreadsheet_data': new_json,
            'spreadsheet_snapshot': False, 
        })
        
        self.env['spreadsheet.revision'].sudo().search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id)
        ]).unlink()

        return True

    # -------------------------------------------------------------------------
    # UTILS SPREADSHEET
    # -------------------------------------------------------------------------

    def _format_cell_val(self, val):
        if val is None or val is False: return ""
        if isinstance(val, (int, float)): return str(val)
        result = str(val).strip()
        return result if result else ""

    def _make_cell(self, val, style=None):
        content = self._format_cell_val(val)
        cell = {"content": content}
        if style is not None: cell["style"] = style
        return cell

    def _get_col_letter(self, n):
        string = ""
        while n >= 0:
            n, remainder = divmod(n, 26)
            string = chr(65 + remainder) + string
            n -= 1
        return string

    def action_open_packing_list_spreadsheet(self):
        self.ensure_one()
        if self.picking_type_code != 'incoming': raise UserError('Solo para Recepciones.')
        
        if not self.spreadsheet_id:
            products = self.move_ids.mapped('product_id')
            if not products: raise UserError('Sin productos.')

            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            
            sheets = []
            for index, product in enumerate(products):
                cells = {}
                cells["A1"] = self._make_cell("PRODUCTO:")
                p_name = self._format_cell_val(product.name)
                p_code = self._format_cell_val(product.default_code)
                cells["B1"] = self._make_cell(f"{p_name} ({p_code})")
                
                for i, header in enumerate(headers):
                    col_letter = self._get_col_letter(i)
                    cells[f"{col_letter}3"] = self._make_cell(header, style=1)

                sheet_name = (product.default_code or product.name)[:31]
                dedup_idx = 1
                orig_name = sheet_name
                while any(s['name'] == sheet_name for s in sheets):
                    sheet_name = f"{orig_name[:25]}_{dedup_idx}"
                    dedup_idx += 1

                sheets.append({
                    "id": f"pl_sheet_{product.id}",
                    "name": sheet_name,
                    "cells": cells,
                    "colNumber": 12,
                    "rowNumber": 250,
                    "isProtected": True,
                    "protectedRanges": [{"range": "A4:L250", "isProtected": False}]
                })

            spreadsheet_data = {
                "version": 16,
                "sheets": sheets,
                "styles": { "1": {"bold": True, "fillColor": "#366092", "textColor": "#FFFFFF", "align": "center"} }
            }

            vals = {
                'name': f'PL: {self.name}.osheet',
                'type': 'binary', 
                'handler': 'spreadsheet',
                'mimetype': 'application/o-spreadsheet',
                'spreadsheet_data': json.dumps(spreadsheet_data, ensure_ascii=False, default=str),
                'res_model': 'stock.picking',
                'res_id': self.id,
            }
            if folder: vals['folder_id'] = folder.id

            self.spreadsheet_id = self.env['documents.document'].create(vals)

        return self._action_launch_spreadsheet(self.spreadsheet_id)

    def action_open_worksheet_spreadsheet(self):
        self.ensure_one()
        if not self.packing_list_imported: raise UserError('Primero debe importar el Packing List.')

        if not self.ws_spreadsheet_id:
            products = self.move_line_ids.mapped('product_id')
            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)
            headers = ['Nº Lote', 'Grosor', 'Alto Teo.', 'Ancho Teo.', 'Color', 'Bloque', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov.', 'ALTO REAL (m)', 'ANCHO REAL (m)']
            
            sheets = []
            for product in products:
                cells = {}
                cells["A1"] = self._make_cell("PRODUCTO:")
                p_name = self._format_cell_val(product.name)
                p_code = self._format_cell_val(product.default_code)
                cells["B1"] = self._make_cell(f"{p_name} ({p_code})")
                
                for i, header in enumerate(headers):
                    col_letter = self._get_col_letter(i)
                    cells[f"{col_letter}3"] = self._make_cell(header, style=2)

                move_lines = self.move_line_ids.filtered(lambda ml: ml.product_id == product and ml.lot_id)
                row_idx = 4
                for ml in move_lines:
                    lot = ml.lot_id
                    cells[f"A{row_idx}"] = self._make_cell(lot.name)
                    cells[f"B{row_idx}"] = self._make_cell(lot.x_grosor)
                    cells[f"C{row_idx}"] = self._make_cell(lot.x_alto)
                    cells[f"D{row_idx}"] = self._make_cell(lot.x_ancho)
                    cells[f"E{row_idx}"] = self._make_cell(lot.x_color)
                    cells[f"F{row_idx}"] = self._make_cell(lot.x_bloque)
                    cells[f"G{row_idx}"] = self._make_cell(lot.x_atado)
                    cells[f"H{row_idx}"] = self._make_cell(lot.x_tipo)
                    cells[f"I{row_idx}"] = self._make_cell(", ".join(lot.x_grupo.mapped('name')) if lot.x_grupo else "")
                    cells[f"J{row_idx}"] = self._make_cell(lot.x_pedimento)
                    cells[f"K{row_idx}"] = self._make_cell(lot.x_contenedor)
                    cells[f"L{row_idx}"] = self._make_cell(lot.x_referencia_proveedor)
                    row_idx += 1

                sheet_name = (product.default_code or product.name)[:31]
                sheets.append({
                    "id": f"ws_sheet_{product.id}",
                    "name": sheet_name,
                    "cells": cells,
                    "colNumber": 14,
                    "rowNumber": max(row_idx + 20, 100),
                    "isProtected": True,
                    "protectedRanges": [{"range": f"M4:N{row_idx + 100}", "isProtected": False}]
                })

            spreadsheet_data = {
                "version": 16,
                "sheets": sheets,
                "styles": { "2": {"bold": True, "fillColor": "#1f5b13", "textColor": "#FFFFFF", "align": "center"} }
            }

            vals = {
                'name': f'WS: {self.name}.osheet',
                'type': 'binary', 
                'handler': 'spreadsheet',
                'mimetype': 'application/o-spreadsheet',
                'spreadsheet_data': json.dumps(spreadsheet_data, ensure_ascii=False, default=str),
                'res_model': 'stock.picking',
                'res_id': self.id,
            }
            if folder: vals['folder_id'] = folder.id

            self.ws_spreadsheet_id = self.env['documents.document'].create(vals)

        return self._action_launch_spreadsheet(self.ws_spreadsheet_id)

    def _action_launch_spreadsheet(self, doc):
        doc_sudo = doc.sudo()
        for method in ["action_open_spreadsheet", "action_open", "access_content"]:
            if hasattr(doc_sudo, method):
                try:
                    action = getattr(doc_sudo, method)()
                    if action: return action
                except: continue
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'documents.document',
            'res_id': doc.id,
            'view_mode': 'form',
            'target': 'current',
            'context': {'request_handler': 'spreadsheet'}
        }

    def action_download_packing_template(self):
        self.ensure_one()
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Border, Side
        except ImportError:
            raise UserError('Instale openpyxl')
            
        wb = Workbook(); wb.remove(wb.active)
        header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        
        for product in self.move_ids.mapped('product_id'):
            ws = wb.create_sheet(title=(product.default_code or product.name)[:31])
            ws['A1'] = 'PRODUCTO:'; ws['B1'] = f'{product.name} ({product.default_code or ""})'
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num); cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            for row in range(4, 54):
                for col in range(1, 13): ws.cell(row=row, column=col).border = border
                
        output = io.BytesIO(); wb.save(output)
        filename = f'Plantilla_PL_{self.name}.xlsx'
        self.write({'packing_list_file': base64.b64encode(output.getvalue()), 'packing_list_filename': filename})
        return {'type': 'ir.actions.act_url', 'url': f'/web/content?model=stock.picking&id={self.id}&field=packing_list_file&filename={filename}&download=true', 'target': 'self'}

    def action_download_worksheet(self):
        self.ensure_one()
        if not self.packing_list_imported: raise UserError('Importe primero el Packing List.')
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Border, Side
        except ImportError: raise UserError('Instale openpyxl')
        
        wb = Workbook(); wb.remove(wb.active)
        header_fill = PatternFill(start_color='1f5b13', end_color='1f5b13', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        data_fill = PatternFill(start_color='E7E6E6', end_color='E7E6E6', fill_type='solid')
        editable_fill = PatternFill(start_color='FFFF00', end_color='FFFF00', fill_type='solid')
        border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        
        for product in self.move_line_ids.mapped('product_id'):
            ws = wb.create_sheet(title=(product.default_code or product.name)[:31])
            ws['A1'] = 'PRODUCTO:'; ws['B1'] = f'{product.name} ({product.default_code or ""})'
            headers = ['Lote', 'Grosor', 'Alto Teo.', 'Ancho Teo.', 'Color', 'Bloque', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov', 'Cantidad', 'Alto Real', 'Ancho Real']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num); cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            
            curr = 4
            for ml in self.move_line_ids.filtered(lambda x: x.product_id == product):
                ws.cell(row=curr, column=1, value=ml.lot_id.name).fill = data_fill
                ws.cell(row=curr, column=2, value=ml.lot_id.x_grosor).fill = data_fill
                ws.cell(row=curr, column=3, value=ml.lot_id.x_alto).fill = data_fill
                ws.cell(row=curr, column=4, value=ml.lot_id.x_ancho).fill = data_fill
                ws.cell(row=curr, column=13, value=ml.qty_done).fill = data_fill
                for col in range(1, 14): ws.cell(row=curr, column=col).border = border
                ws.cell(row=curr, column=14).fill = editable_fill; ws.cell(row=curr, column=14).border = border
                ws.cell(row=curr, column=15).fill = editable_fill; ws.cell(row=curr, column=15).border = border
                curr += 1
                
        output = io.BytesIO(); wb.save(output)
        filename = f'Worksheet_{self.name}.xlsx'
        self.write({'worksheet_file': base64.b64encode(output.getvalue()), 'worksheet_filename': filename})
        return {'type': 'ir.actions.act_url', 'url': f'/web/content?model=stock.picking&id={self.id}&field=worksheet_file&filename={filename}&download=true', 'target': 'self'}

    def action_import_packing_list(self):
        self.ensure_one()
        if self.worksheet_imported: raise UserError('El Worksheet ya fue procesado.')
        
        title = 'Aplicar Cambios al PL' if self.packing_list_imported else 'Importar Packing List'
        return {
            'name': title, 
            'type': 'ir.actions.act_window', 
            'res_model': 'packing.list.import.wizard', 
            'view_mode': 'form', 
            'target': 'new', 
            'context': {'default_picking_id': self.id}
        }
    
    def action_import_worksheet(self):
        self.ensure_one()
        return {
            'name': 'Procesar Worksheet', 
            'type': 'ir.actions.act_window', 
            'res_model': 'worksheet.import.wizard', 
            'view_mode': 'form', 
            'target': 'new', 
            'context': {'default_picking_id': self.id}
        }

    # -------------------------------------------------------------------------
    # FUNCIONALIDAD ORIGINAL DE PROCESAMIENTO (IMPORT WIZARD)
    # -------------------------------------------------------------------------

    def process_external_pl_data(self, json_data):
        """ 
        Legacy: Mantenido por compatibilidad si se llamara externamente.
        Ahora se prefiere usar el wizard 'packing.list.import.wizard' que lee el spreadsheet.
        """
        return True```

## ./models/supplier_access.py
```py
# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta
from odoo import models, fields, api


class SupplierAccess(models.Model):
    _name = 'stock.picking.supplier.access'
    _description = 'Token de Acceso a Portal de Proveedor'
    _order = 'create_date desc'

    picking_id = fields.Many2one('stock.picking', string="Recepción", required=True, ondelete='cascade')
    purchase_id = fields.Many2one('purchase.order', string="Orden de Compra", ondelete='cascade')

    access_token = fields.Char(
        string="Token", required=True, default=lambda self: str(uuid.uuid4()), readonly=True, copy=False
    )
    expiration_date = fields.Datetime(
        string="Expira",
        required=True,
        default=lambda self: fields.Datetime.now() + timedelta(days=15),
        copy=False
    )
    is_expired = fields.Boolean(compute="_compute_expired", store=False)
    portal_url = fields.Char(compute="_compute_url", store=False)

    _sql_constraints = [
        # 1 link por PO. (PostgreSQL permite múltiples NULL en UNIQUE, así que no rompe casos sin purchase_id)
        ('supplier_access_unique_purchase', 'unique(purchase_id)', 'Ya existe un link para esta Orden de Compra.'),
    ]

    @api.depends('expiration_date')
    def _compute_expired(self):
        now = fields.Datetime.now()
        for rec in self:
            rec.is_expired = bool(rec.expiration_date and rec.expiration_date < now)

    @api.depends('access_token')
    def _compute_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        for rec in self:
            rec.portal_url = f"{base_url}/supplier/pl/{rec.access_token}"
```

## ./security/stock_lot_hold_security.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <data noupdate="1">
        <!-- Regla multi-compañía para packing.list.import.wizard -->
        <record id="packing_list_import_wizard_comp_rule" model="ir.rule">
            <field name="name">Packing List Import Wizard: multi-company</field>
            <field name="model_id" ref="model_packing_list_import_wizard"/>
            <field name="domain_force">[('picking_id.company_id', 'in', company_ids)]</field>
            <field name="global" eval="True"/>
        </record>

        <!-- Regla multi-compañía para worksheet.import.wizard -->
        <record id="worksheet_import_wizard_comp_rule" model="ir.rule">
            <field name="name">Worksheet Import Wizard: multi-company</field>
            <field name="model_id" ref="model_worksheet_import_wizard"/>
            <field name="domain_force">[('picking_id.company_id', 'in', company_ids)]</field>
            <field name="global" eval="True"/>
        </record>
    </data>
</odoo>```

## ./static/src/js/supplier_portal.js
```js
/* static/src/js/supplier_portal.js */
(function () {
    "use strict";

    console.log("[Portal] 🚀 Script cargado.");

    class SupplierPortal {
        constructor() {
            this.data = {};
            this.products = [];
            this.rows = [];
            this.header = {}; // Datos de cabecera (Factura, BL, etc.)
            this.nextId = 1;
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        init() {
            console.log("[Portal] Iniciando...");
            
            try {
                // 1. LEER DATOS DEL DOM
                const dataEl = document.getElementById('portal-data-store');
                if (!dataEl) throw new Error("Datos no encontrados en HTML.");
                const rawJson = dataEl.dataset.payload;
                if (!rawJson) throw new Error("Payload vacío.");

                this.data = JSON.parse(rawJson);
                this.products = this.data.products || [];
                // Cargar cabecera inicial desde el servidor si existe
                this.header = this.data.header || {};

                if (!this.data.token) throw new Error("Token no encontrado.");

                console.log(`[Portal] Token: ...${this.data.token.slice(-4)}`);
                
                // 2. ESTRATEGIA DE CARGA (Bidireccional)
                // Prioridad: Local > Server > Default
                
                const localData = this.loadLocalState();
                const serverRows = this.data.existing_rows || [];

                if (localData && localData.rows && localData.rows.length > 0) {
                    console.log("[Portal] Usando datos locales (borrador en progreso).");
                    this.rows = localData.rows;
                    
                    // Fusionar cabecera local con la del servidor (local gana)
                    if (localData.header && Object.keys(localData.header).length > 0) {
                        this.header = { ...this.header, ...localData.header };
                    }

                    // Recalcular nextId para no pisar IDs
                    const maxId = this.rows.reduce((max, r) => Math.max(max, r.id || 0), 0);
                    this.nextId = maxId + 1;

                } else if (serverRows.length > 0) {
                    console.log(`[Portal] Usando datos del servidor (${serverRows.length} filas recuperadas).`);
                    // Asignar IDs temporales a los datos que vienen del servidor
                    this.rows = serverRows.map(r => ({
                        ...r,
                        id: this.nextId++
                    }));
                    // Guardar inmediatamente en local para que sean editables
                    this.saveState();

                } else {
                    console.log("[Portal] Iniciando desde cero (sin datos previos).");
                    if (this.products.length > 0) {
                        this.products.forEach(p => this.createRowInternal(p.id));
                    }
                }

                // 3. RENDERIZADO Y BINDING
                this.fillHeaderForm(); // Llenar inputs de cabecera con los datos cargados
                this.render();
                this.bindGlobalEvents();

                console.log("[Portal] ✅ Interfaz lista.");

            } catch (error) {
                console.error("[Portal] 🛑 Error Fatal:", error);
                const container = document.getElementById('portal-rows-container');
                if (container) {
                    container.innerHTML = `<div class="alert alert-danger text-center p-5"><h4>Error</h4><p>${error.message}</p></div>`;
                }
            }
        }

        // --- GESTIÓN DE ESTADO ---

        loadLocalState() {
            if (!this.data.token) return null;
            const key = `pl_portal_${this.data.token}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // Compatibilidad con versiones viejas que solo guardaban array de filas
                    if (Array.isArray(parsed)) {
                        return { rows: parsed, header: {} };
                    }
                    return parsed;
                } catch (e) {
                    console.error("Error localStorage", e);
                    return null;
                }
            }
            return null;
        }

        saveState() {
            if (!this.data.token) return;
            const key = `pl_portal_${this.data.token}`;
            
            // Guardamos filas Y el estado actual del formulario de cabecera
            const state = {
                rows: this.rows,
                header: this.getHeaderDataFromDOM()
            };
            
            localStorage.setItem(key, JSON.stringify(state));
            this.updateTotalsUI(); 
        }

        // --- CABECERA (Header) ---

        fillHeaderForm() {
            // Mapeo ID del HTML -> Clave del objeto header
            const map = {
                'h-invoice': 'invoice_number',
                'h-date': 'shipment_date',
                'h-proforma': 'proforma_number',
                'h-bl': 'bl_number',
                'h-origin': 'origin',
                'h-dest': 'destination',
                'h-country': 'country_origin',
                'h-vessel': 'vessel',
                'h-incoterm': 'incoterm_payment',
                'h-desc': 'merchandise_desc',
                'h-cont-no': 'container_no',
                'h-seal': 'seal_no',
                'h-type': 'container_type',
                'h-status': 'status',
                'h-pkgs': 'total_packages',
                'h-weight': 'gross_weight',
                'h-volume': 'volume'
            };

            for (const [domId, dataKey] of Object.entries(map)) {
                const el = document.getElementById(domId);
                if (el && this.header[dataKey] !== undefined && this.header[dataKey] !== null) {
                    el.value = this.header[dataKey];
                }
            }
        }

        getHeaderDataFromDOM() {
            // Recoger valores actuales de los inputs
            return {
                invoice_number: document.getElementById('h-invoice')?.value || "",
                shipment_date: document.getElementById('h-date')?.value || "",
                proforma_number: document.getElementById('h-proforma')?.value || "",
                bl_number: document.getElementById('h-bl')?.value || "",
                origin: document.getElementById('h-origin')?.value || "",
                destination: document.getElementById('h-dest')?.value || "",
                country_origin: document.getElementById('h-country')?.value || "",
                vessel: document.getElementById('h-vessel')?.value || "",
                incoterm_payment: document.getElementById('h-incoterm')?.value || "",
                merchandise_desc: document.getElementById('h-desc')?.value || "",
                container_no: document.getElementById('h-cont-no')?.value || "",
                seal_no: document.getElementById('h-seal')?.value || "",
                container_type: document.getElementById('h-type')?.value || "",
                status: document.getElementById('h-status')?.value || "",
                total_packages: document.getElementById('h-pkgs')?.value || 0,
                gross_weight: document.getElementById('h-weight')?.value || 0.0,
                volume: document.getElementById('h-volume')?.value || 0.0,
            };
        }

        // --- LÓGICA DE FILAS (PACKING LIST) ---

        createRowInternal(productId) {
            const productRows = this.rows.filter(r => r.product_id === productId);
            let defaults = { contenedor: '', bloque: '', grosor: 0 };
            
            if (productRows.length > 0) {
                const last = productRows[productRows.length - 1];
                defaults = { 
                    contenedor: last.contenedor, 
                    bloque: last.bloque, 
                    grosor: last.grosor 
                };
            }

            const newRow = {
                id: this.nextId++,
                product_id: productId,
                contenedor: defaults.contenedor,
                bloque: defaults.bloque,
                grosor: defaults.grosor,
                alto: 0,
                ancho: 0,
                color: '',
                ref_prov: ''
            };
            
            this.rows.push(newRow);
            return newRow;
        }

        deleteRowInternal(id) {
            this.rows = this.rows.filter(r => r.id !== parseInt(id));
        }

        updateRowData(id, field, value) {
            const row = this.rows.find(r => r.id === parseInt(id));
            if (row) {
                if (['grosor', 'alto', 'ancho'].includes(field)) {
                    row[field] = parseFloat(value) || 0;
                } else {
                    row[field] = value;
                }
                this.saveState();
            }
        }

        // --- RENDERIZADO DE TABLAS ---

        render() {
            const container = document.getElementById('portal-rows-container');
            if (!container) return;

            if (this.products.length === 0) {
                container.innerHTML = '<div class="alert alert-warning text-center p-5">No hay productos pendientes de recepción en esta orden.</div>';
                return;
            }

            let html = '';

            this.products.forEach(product => {
                const productRows = this.rows.filter(r => r.product_id === product.id);
                
                html += `
                    <div class="product-section">
                        <div class="product-header">
                            <div>
                                <h3>${product.name} <span class="text-muted small ms-2">(${product.code})</span></h3>
                            </div>
                            <div class="meta">
                                Solicitado: <strong class="text-white">${product.qty_ordered} ${product.uom}</strong>
                            </div>
                        </div>

                        <div class="table-responsive">
                            <table class="portal-table">
                                <thead>
                                    <tr>
                                        <th>Contenedor</th>
                                        <th>Bloque</th>
                                        <th>Grosor (cm)</th>
                                        <th>Alto (m)</th>
                                        <th>Ancho (m)</th>
                                        <th>Área (m²)</th>
                                        <th>Color / Notas</th>
                                        <th style="width: 50px;"></th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                productRows.forEach(row => {
                    const area = (row.alto * row.ancho).toFixed(2);
                    html += `
                        <tr data-row-id="${row.id}">
                            <td><input type="text" class="short text-uppercase input-field" data-field="contenedor" value="${row.contenedor || ''}" placeholder="CNT01"></td>
                            <td><input type="text" class="short text-uppercase input-field" data-field="bloque" value="${row.bloque || ''}" placeholder="B-01"></td>
                            <td><input type="number" step="0.01" class="short input-field" data-field="grosor" value="${row.grosor || ''}"></td>
                            <td><input type="number" step="0.01" class="short input-field" data-field="alto" value="${row.alto || ''}"></td>
                            <td><input type="number" step="0.01" class="short input-field" data-field="ancho" value="${row.ancho || ''}"></td>
                            <td><span class="fw-bold text-white area-display">${area}</span></td>
                            <td><input type="text" class="input-field" data-field="color" value="${row.color || ''}" placeholder="Opcional"></td>
                            <td class="text-center">
                                <button class="btn-action btn-delete" type="button"><i class="fa fa-trash"></i></button>
                            </td>
                        </tr>
                    `;
                });

                html += `
                                </tbody>
                            </table>
                            <div class="mt-2">
                                <button class="btn-add-row action-add" data-product-id="${product.id}" type="button">
                                    <i class="fa fa-plus-circle"></i> Agregar Placa
                                </button>
                                <button class="btn-add-row ms-2 action-add-multi" data-product-id="${product.id}" type="button">
                                    +5 Filas
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
            this.updateTotalsUI();
        }

        bindGlobalEvents() {
            const container = document.getElementById('portal-rows-container');
            const headerForm = document.getElementById('shipment-info-form'); // Contenedor del form de cabecera
            const submitBtn = document.getElementById('btn-submit-pl');
            
            // Clonar para limpiar eventos antiguos (safety)
            const newContainer = container.cloneNode(true);
            container.parentNode.replaceChild(newContainer, container);
            
            const activeContainer = document.getElementById('portal-rows-container');

            // 1. Inputs Tabla (Change & Input)
            activeContainer.addEventListener('input', (e) => {
                if (e.target.classList.contains('input-field')) {
                    const tr = e.target.closest('tr');
                    const rowId = tr.dataset.rowId;
                    const field = e.target.dataset.field;
                    this.updateRowData(rowId, field, e.target.value);
                    
                    if (field === 'alto' || field === 'ancho') {
                        const row = this.rows.find(r => r.id === parseInt(rowId));
                        const areaSpan = tr.querySelector('.area-display');
                        if (areaSpan && row) {
                            areaSpan.innerText = (row.alto * row.ancho).toFixed(2);
                        }
                        this.updateTotalsUI();
                    }
                }
            });

            // 2. Click Buttons Tabla
            activeContainer.addEventListener('click', (e) => {
                const target = e.target;
                
                const delBtn = target.closest('.btn-delete');
                if (delBtn) {
                    this.deleteRowInternal(delBtn.closest('tr').dataset.rowId);
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                    return;
                }

                const addBtn = target.closest('.action-add');
                if (addBtn) {
                    this.createRowInternal(parseInt(addBtn.dataset.productId));
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                    return;
                }

                const addMulti = target.closest('.action-add-multi');
                if (addMulti) {
                    const pid = parseInt(addMulti.dataset.productId);
                    for(let i=0; i<5; i++) this.createRowInternal(pid);
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                }
            });

            // 3. Inputs Header (Auto-save local)
            if (headerForm) {
                // Removemos listener previo clonando si es necesario, o solo agregamos.
                // Como headerForm está fuera de portal-rows-container, es estático.
                // Usamos un flag o simplemente agregamos (addEventListener permite múltiples, pero es mejor controlar)
                headerForm.oninput = () => {
                    this.saveState();
                };
            }

            // 4. Submit
            if (submitBtn) {
                const newBtn = submitBtn.cloneNode(true);
                submitBtn.parentNode.replaceChild(newBtn, submitBtn);
                newBtn.addEventListener('click', () => this.submitData());
            }
        }

        updateTotalsUI() {
            const validRows = this.rows.filter(r => r.alto > 0 && r.ancho > 0);
            const count = validRows.length;
            const totalArea = validRows.reduce((acc, r) => acc + (r.alto * r.ancho), 0);

            const countEl = document.getElementById('total-plates');
            const areaEl = document.getElementById('total-area');
            const btn = document.getElementById('btn-submit-pl');

            if (countEl) countEl.innerText = count;
            if (areaEl) areaEl.innerText = totalArea.toFixed(2);
            
            if (btn) {
                // Permitimos enviar si hay cabecera aunque no haya filas, o viceversa.
                // Pero generalmente queremos al menos una acción. 
                // Dejamos activo siempre para permitir guardar solo cabecera si se desea.
                btn.removeAttribute('disabled');
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        }

        async submitData() {
            if (!confirm("¿Está seguro de enviar los datos? Se actualizará el documento en el sistema.")) return;

            const btn = document.getElementById('btn-submit-pl');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa fa-spinner fa-spin me-2"></i> Guardando...';
            btn.disabled = true;

            const cleanData = this.rows
                .filter(r => r.alto > 0 && r.ancho > 0)
                .map(r => ({
                    product_id: r.product_id,
                    contenedor: r.contenedor,
                    bloque: r.bloque,
                    grosor: r.grosor,
                    alto: r.alto,
                    ancho: r.ancho,
                    color: r.color,
                    tipo: 'placa'
                }));

            // Recoger datos de cabecera
            const headerData = this.getHeaderDataFromDOM();

            try {
                const res = await fetch('/supplier/pl/submit', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "call",
                        params: { 
                            token: this.data.token, 
                            rows: cleanData,
                            header: headerData  // Enviamos la cabecera
                        },
                        id: Math.floor(Math.random()*1000)
                    })
                });

                const result = await res.json();
                
                if (result.result && result.result.success) {
                    alert("✅ Guardado correctamente.");
                    // Limpiamos local storage para evitar conflictos futuros
                    localStorage.removeItem(`pl_portal_${this.data.token}`);
                    window.location.reload();
                } else {
                    const msg = result.error?.data?.message || result.result?.message || "Error desconocido";
                    alert("❌ Error: " + msg);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            } catch (error) {
                console.error(error);
                alert("Error de conexión con el servidor.");
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    window.supplierPortal = new SupplierPortal();
})();```

## ./static/src/scss/supplier_portal.scss
```scss
/* static/src/scss/supplier_portal.scss */

/* --- Variables --- */
$bg-dark: #121212;
$bg-card: #1e1e1e;
$bg-input: #2a2a2a;
$primary-brown: #d4af37; /* Dorado elegante en lugar de marrón plano */
$primary-hover: #b5952f;
$text-white: #ffffff;
$text-gray: #a0a0a0;
$border-color: #333;
$input-border: #444;

body {
    background-color: $bg-dark;
    color: $text-white;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 0.95rem;
}

/* --- Header Fijo --- */
.o_portal_header {
    background: rgba(18, 18, 18, 0.95);
    border-bottom: 1px solid $border-color;
    padding: 1rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 1000;
    backdrop-filter: blur(10px);
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);

    .brand {
        font-size: 1.4rem;
        font-weight: 700;
        letter-spacing: 1px;
        color: $text-white;
        display: flex;
        align-items: center;
        
        i { color: $primary-brown; font-size: 1.2rem; }
    }
    
    .po-info {
        text-align: right;
        .label { 
            font-size: 0.7rem; 
            color: $text-gray; 
            text-transform: uppercase; 
            letter-spacing: 0.5px; 
            display: block;
        }
        .value { 
            font-weight: 600; 
            color: #fff; 
            font-size: 0.95rem;
        }
    }
}

.o_portal_container {
    max-width: 1400px;
    margin: 2rem auto;
    padding: 0 1.5rem;
}

/* --- SECCIÓN DATOS DE EMBARQUE (MODERNA) --- */
.shipment-card {
    background: $bg-card;
    border: 1px solid $border-color;
    border-radius: 12px;
    margin-bottom: 2.5rem;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    overflow: hidden;

    .card-header {
        background: linear-gradient(90deg, #252525 0%, #1e1e1e 100%);
        padding: 1.2rem 1.5rem;
        border-bottom: 1px solid $border-color;
        display: flex;
        align-items: center;
        gap: 10px;

        h3 {
            margin: 0;
            font-size: 1.1rem;
            color: $primary-brown;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
    }

    .card-body {
        padding: 2rem;
    }
}

/* Grid de Formulario */
.modern-form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1.5rem 2rem;
    
    .form-group {
        display: flex;
        flex-direction: column;
        
        label {
            color: $text-gray;
            font-size: 0.8rem;
            margin-bottom: 0.5rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
            
            i { color: $primary-brown; opacity: 0.7; }
        }

        /* --- CORRECCIÓN DE CONTRASTE INPUTS --- */
        .form-control {
            background-color: $bg-input !important;
            border: 1px solid $input-border !important;
            color: $text-white !important;
            border-radius: 6px;
            padding: 10px 12px;
            font-size: 0.95rem;
            transition: all 0.3s ease;
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);

            &::placeholder {
                color: darken($text-gray, 20%);
            }

            &:focus {
                background-color: lighten($bg-input, 5%) !important;
                border-color: $primary-brown !important;
                box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.15), inset 0 1px 2px rgba(0,0,0,0.2);
                outline: none;
            }

            &:hover {
                border-color: lighten($input-border, 15%) !important;
            }
            
            /* Input date fix icon color */
            &[type="date"] {
                color-scheme: dark;
            }
        }
    }
    
    /* Span completo para textareas o campos grandes */
    .full-width {
        grid-column: 1 / -1;
    }
}

.section-divider {
    grid-column: 1 / -1;
    border-top: 1px dashed $border-color;
    margin: 1rem 0;
    position: relative;
    
    span {
        position: absolute;
        top: -10px;
        left: 0;
        background: $bg-card;
        padding-right: 10px;
        color: darken($text-gray, 20%);
        font-size: 0.75rem;
        text-transform: uppercase;
        font-weight: bold;
    }
}

/* --- TABLAS (Packing List) --- */
.product-section {
    background: $bg-card;
    border: 1px solid $border-color;
    border-radius: 12px;
    margin-bottom: 2rem;
    overflow: hidden;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);

    .product-header {
        background: #252525;
        padding: 1rem 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid $border-color;

        h3 { 
            margin: 0; font-size: 1rem; color: #fff; font-weight: 600;
            .code { color: $text-gray; font-weight: 400; font-size: 0.9rem; margin-left: 5px; }
        }
        .meta { color: $primary-brown; font-size: 0.9rem; font-weight: 600; }
    }

    .table-responsive {
        padding: 0;
    }
}

.portal-table {
    width: 100%;
    border-collapse: collapse;
    color: $text-gray;

    th {
        text-align: left;
        padding: 1rem;
        background: rgba(255,255,255,0.02);
        color: lighten($text-gray, 10%);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid $border-color;
        font-weight: 600;
    }

    td {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #2a2a2a;
        vertical-align: middle;
        
        input {
            background: $bg-dark;
            border: 1px solid $input-border;
            color: $text-white;
            padding: 8px 10px;
            border-radius: 6px;
            width: 100%;
            transition: border-color 0.2s;
            font-family: monospace; /* Para alinear números mejor */

            &:focus {
                outline: none;
                border-color: $primary-brown;
                background: lighten($bg-dark, 5%);
            }
            
            &.short { width: 90px; }
        }
        
        .area-display {
            color: $primary-brown;
            font-weight: 700;
            font-family: monospace;
        }
    }

    tr:last-child td { border-bottom: none; }
    
    tr:hover td {
        background: rgba(255,255,255,0.02);
    }

    .btn-action {
        background: rgba(217, 83, 79, 0.1);
        border: 1px solid rgba(217, 83, 79, 0.3);
        color: #ff6b6b;
        width: 32px; height: 32px;
        border-radius: 6px;
        cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        transition: all 0.2s;
        
        &:hover { background: #d9534f; color: #fff; }
    }
}

/* Toolbar de tabla */
.table-toolbar {
    padding: 1rem 1.5rem;
    background: #222;
    border-top: 1px solid $border-color;
    display: flex;
    gap: 10px;
}

.btn-add-row {
    background: transparent;
    color: $text-gray;
    border: 1px dashed $text-gray;
    padding: 6px 15px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s;

    &:hover { 
        background: rgba(255,255,255,0.05); 
        color: #fff; 
        border-color: #fff;
    }
    
    &.primary-add {
        border-style: solid;
        border-color: $primary-brown;
        color: $primary-brown;
        &:hover { background: $primary-brown; color: #000; }
    }
}

/* Footer Flotante */
.submit-footer {
    position: fixed;
    bottom: 0; left: 0; width: 100%;
    background: rgba(25, 25, 25, 0.95);
    padding: 1rem 2rem;
    border-top: 1px solid $primary-brown;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 999;
    backdrop-filter: blur(10px);
    box-shadow: 0 -5px 20px rgba(0,0,0,0.5);

    .summary {
        color: $text-gray;
        font-size: 0.9rem;
        display: flex;
        gap: 20px;
        
        div {
            background: #333;
            padding: 5px 15px;
            border-radius: 20px;
            
            span { color: $text-white; font-weight: bold; margin-left: 5px; color: $primary-brown; }
        }
    }
}

.btn-primary-custom {
    background: $primary-brown;
    color: #000;
    border: none;
    padding: 12px 30px;
    border-radius: 30px;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.3s;
    box-shadow: 0 4px 15px rgba(212, 175, 55, 0.3);
    
    &:hover { 
        background: #fff; 
        box-shadow: 0 6px 20px rgba(255,255,255,0.2);
        transform: translateY(-2px);
    }
    
    &:disabled { 
        background: #444; 
        color: #777; 
        cursor: not-allowed; 
        box-shadow: none;
        transform: none;
    }
}

/* Mobile Adjustments */
@media (max-width: 768px) {
    .modern-form-grid { grid-template-columns: 1fr; }
    .submit-footer { flex-direction: column; gap: 15px; }
    .summary { width: 100%; justify-content: space-between; font-size: 0.8rem; }
    .btn-primary-custom { width: 100%; }
}```

## ./static/src/xml/supplier_portal.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<templates xml:space="preserve">
    <t t-name="stock_lot_packing_import.SupplierPortalApp">
        <div class="o_portal_wrapper">
            
            <!-- HEADER -->
            <header class="o_portal_header">
                <div class="brand">
                    <i class="fa fa-cubes me-2"/>PORTAL <span class="ms-1">PROVEEDOR</span>
                </div>
                <div class="po-info">
                    <div><span class="label">Orden de Compra:</span> <span class="value" t-esc="state.data.poName"/></div>
                    <div><span class="label">Recepción:</span> <span class="value" t-esc="state.data.pickingName"/></div>
                </div>
            </header>

            <!-- CONTENIDO -->
            <div class="o_portal_container pb-5 mb-5">
                
                <div class="alert alert-info bg-dark border-secondary text-light mb-4">
                    <i class="fa fa-info-circle me-2 text-warning"/>
                    Por favor ingrese las dimensiones y detalles de cada placa o bloque. No necesita agrupar, el sistema lo hará automáticamente.
                </div>

                <!-- LISTA DE PRODUCTOS -->
                <t t-foreach="state.products" t-as="product" t-key="product.id">
                    <div class="product-section">
                        <div class="product-header">
                            <div>
                                <h3><t t-esc="product.name"/> <span class="text-muted small ms-2">(<t t-esc="product.code"/>)</span></h3>
                            </div>
                            <div class="meta">
                                Solicitado: <strong class="text-white"><t t-esc="product.qty_ordered"/> <t t-esc="product.uom"/></strong>
                            </div>
                        </div>

                        <div class="table-responsive">
                            <table class="portal-table">
                                <thead>
                                    <tr>
                                        <th>Contenedor</th>
                                        <th>Bloque</th>
                                        <th>Grosor (cm)</th>
                                        <th>Alto (m)</th>
                                        <th>Ancho (m)</th>
                                        <th>Área (m²)</th>
                                        <th>Color / Notas</th>
                                        <th style="width: 50px;"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <t t-foreach="getProductRows(product.id)" t-as="row" t-key="row.id">
                                        <tr>
                                            <td>
                                                <input type="text" class="short text-uppercase" placeholder="CNT01" 
                                                       t-model="row.contenedor" t-on-change="saveState"/>
                                            </td>
                                            <td>
                                                <input type="text" class="short text-uppercase" placeholder="B-01" 
                                                       t-model="row.bloque" t-on-change="saveState"/>
                                            </td>
                                            <td>
                                                <input type="number" step="0.01" class="short" 
                                                       t-model.number="row.grosor" t-on-change="saveState"/>
                                            </td>
                                            <td>
                                                <input type="number" step="0.01" class="short" 
                                                       t-model.number="row.alto" t-on-change="saveState"/>
                                            </td>
                                            <td>
                                                <input type="number" step="0.01" class="short" 
                                                       t-model.number="row.ancho" t-on-change="saveState"/>
                                            </td>
                                            <td>
                                                <span class="fw-bold text-white">
                                                    <t t-esc="(row.alto * row.ancho).toFixed(2)"/>
                                                </span>
                                            </td>
                                            <td>
                                                <input type="text" placeholder="Opcional" t-model="row.color" t-on-change="saveState"/>
                                            </td>
                                            <td class="text-center">
                                                <button class="btn-action" t-on-click="() => this.deleteRow(row.id)">
                                                    <i class="fa fa-trash"/>
                                                </button>
                                            </td>
                                        </tr>
                                    </t>
                                </tbody>
                            </table>
                            
                            <div class="mt-2">
                                <button class="btn-add-row" t-on-click="() => this.addRow(product.id)">
                                    <i class="fa fa-plus-circle"/> Agregar Placa
                                </button>
                                <button class="btn-add-row ms-2" t-on-click="() => this.addMultipleRows(product.id, 5)">
                                    +5 Filas
                                </button>
                            </div>
                        </div>
                    </div>
                </t>
            </div>

            <!-- FOOTER FLOTANTE -->
            <div class="submit-footer">
                <div class="summary">
                    Total Placas: <span t-esc="totalPlates"/> | 
                    Total Área: <span t-esc="totalArea"/> m²
                </div>
                <button class="btn-primary-custom" 
                        t-on-click="submitData" 
                        t-att-disabled="state.isSubmitting or totalPlates == 0">
                    <t t-if="state.isSubmitting">
                        <i class="fa fa-spinner fa-spin me-2"/> Enviando...
                    </t>
                    <t t-else="">
                        <i class="fa fa-paper-plane me-2"/> Enviar Packing List
                    </t>
                </button>
            </div>

        </div>
    </t>
</templates>```

## ./views/purchase_order_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_purchase_order_form_inherit_supplier_portal" model="ir.ui.view">
        <field name="name">purchase.order.form.inherit.supplier.portal</field>
        <field name="model">purchase.order</field>
        <field name="inherit_id" ref="purchase.purchase_order_form"/>
        <field name="arch" type="xml">

            <xpath expr="//header" position="inside">
                <button name="action_open_supplier_link_wizard"
                        string="Portal Proveedor (PL)"
                        type="object"
                        class="btn-dark"
                        icon="fa-share-alt"
                        invisible="state not in ('purchase', 'done')"/>
            </xpath>

            <xpath expr="//notebook" position="inside">
                <page string="Links Portal" invisible="not supplier_access_ids">
                    <field name="supplier_access_ids">
                        <list create="0" delete="0" edit="0">
                            <field name="create_date" string="Generado"/>
                            <field name="picking_id" string="Para Recepción"/>
                            <field name="expiration_date"/>
                            <field name="is_expired" widget="boolean_toggle"/>
                            <field name="portal_url" widget="CopyClipboardChar" readonly="1"/>
                        </list>
                    </field>
                </page>
            </xpath>

        </field>
    </record>
</odoo>
```

## ./views/stock_picking_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_picking_form_inherit_packing_import" model="ir.ui.view">
        <field name="name">stock.picking.form.inherit.packing.import</field>
        <field name="model">stock.picking</field>
        <field name="inherit_id" ref="stock.view_picking_form"/>
        <field name="arch" type="xml">
            
            <field name="partner_id" position="after">
                <field name="has_packing_list" invisible="1"/>
                <field name="packing_list_imported" invisible="1"/>
                <field name="worksheet_imported" invisible="1"/>
                <field name="spreadsheet_id" invisible="1"/>
                <field name="ws_spreadsheet_id" invisible="1"/>
                <field name="packing_list_file" invisible="1"/>
                <field name="packing_list_filename" invisible="1"/>
                <field name="worksheet_file" invisible="1"/>
                <field name="worksheet_filename" invisible="1"/>
                <field name="supplier_access_ids" invisible="1"/>
            </field>
            
            <xpath expr="//header/button[@name='action_assign']" position="after">
                <!-- Botones de Acción (Spreadsheets y Wizards) -->
                <button name="action_open_packing_list_spreadsheet"
                        string="Abrir PL"
                        type="object"
                        class="btn-primary"
                        icon="fa-table"
                        invisible="state in ('done', 'cancel', 'draft') or picking_type_code != 'incoming' or packing_list_imported or worksheet_imported"/>

                <button name="action_import_packing_list"
                        string="Procesar PL"
                        type="object"
                        class="btn-secondary"
                        icon="fa-cogs"
                        invisible="state in ('done', 'cancel', 'draft') or picking_type_code != 'incoming' or packing_list_imported or not spreadsheet_id or worksheet_imported"/>

                <button name="action_open_packing_list_spreadsheet"
                        string="Corregir PL"
                        type="object"
                        class="btn-warning"
                        icon="fa-edit"
                        invisible="state in ('done', 'cancel', 'draft') or picking_type_code != 'incoming' or not packing_list_imported or worksheet_imported"/>

                <button name="action_import_packing_list"
                        string="Reprocesar PL"
                        type="object"
                        class="btn-warning"
                        icon="fa-refresh"
                        invisible="state in ('done', 'cancel', 'draft') or picking_type_code != 'incoming' or not packing_list_imported or worksheet_imported"/>

                <button name="action_open_worksheet_spreadsheet"
                        string="Abrir WS"
                        type="object"
                        class="btn-info"
                        icon="fa-balance-scale"
                        invisible="state in ('done', 'cancel', 'draft') or picking_type_code != 'incoming' or not packing_list_imported"/>

                <button name="action_import_worksheet"
                        string="Procesar WS"
                        type="object"
                        class="btn-success"
                        icon="fa-check-square-o"
                        invisible="state in ('done', 'cancel', 'draft') or picking_type_code != 'incoming' or not packing_list_imported or not ws_spreadsheet_id"/>
            </xpath>

            <!-- Nueva Pestaña: Datos de Embarque -->
            <xpath expr="//notebook" position="inside">
                <page string="Datos de Embarque" invisible="picking_type_code != 'incoming'">
                    <group>
                        <group string="Documentación">
                            <field name="supplier_invoice_number"/>
                            <field name="supplier_shipment_date"/>
                            <field name="supplier_proforma_number"/>
                            <field name="supplier_bl_number"/>
                            <field name="supplier_incoterm_payment"/>
                        </group>
                        <group string="Logística">
                            <field name="supplier_origin"/>
                            <field name="supplier_destination"/>
                            <field name="supplier_country_origin"/>
                            <field name="supplier_vessel"/>
                            <field name="supplier_status"/>
                        </group>
                    </group>
                    <group string="Detalles de Carga">
                        <group>
                            <field name="supplier_container_no"/>
                            <field name="supplier_seal_no"/>
                            <field name="supplier_container_type"/>
                        </group>
                        <group>
                            <field name="supplier_total_packages"/>
                            <field name="supplier_gross_weight"/>
                            <field name="supplier_volume"/>
                        </group>
                    </group>
                    <group string="Descripción">
                        <field name="supplier_merchandise_desc" nolabel="1" placeholder="Descripción general de la mercancía..."/>
                    </group>
                </page>

                <page string="Acceso Proveedor" invisible="not supplier_access_ids">
                    <field name="supplier_access_ids" readonly="1">
                        <list create="0" delete="0" edit="0">
                            <field name="create_date" string="Generado"/>
                            <field name="purchase_id" string="Desde OC"/>
                            <field name="is_expired" widget="boolean_toggle"/>
                            <field name="portal_url" widget="CopyClipboardChar"/>
                        </list>
                    </field>
                </page>
            </xpath>

        </field>
    </record>
</odoo>```

## ./views/supplier_portal_templates.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <template id="portal_layout">
        <t t-call="web.frontend_layout">
            <t t-set="no_header" t-value="True"/>
            <t t-set="no_footer" t-value="True"/>
            <t t-set="head">
                <t t-call-assets="web.assets_frontend" t-css="true" t-js="true"/>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&amp;display=swap" rel="stylesheet"/>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css"/>
            </t>
            <div class="supplier-portal-body">
                <t t-out="0"/>
            </div>
        </t>
    </template>

    <template id="supplier_portal_view">
        <t t-call="stock_lot_packing_import.portal_layout">
            
            <div id="portal-data-store" style="display:none;" t-att-data-payload="portal_json"></div>

            <div class="o_portal_wrapper">
                <!-- HEADER ESTATICO -->
                <header class="o_portal_header">
                    <div class="brand">
                        <i class="fa fa-cubes me-2"/>PORTAL <span class="ms-1">PROVEEDOR</span>
                    </div>
                    <div class="po-info">
                        <div><span class="label">Orden de Compra:</span> <span class="value" t-esc="picking.origin or 'N/A'"/></div>
                        <div><span class="label">Recepción:</span> <span class="value" t-esc="picking.name"/></div>
                    </div>
                </header>

                <div class="o_portal_container pb-5 mb-5">
                    
                    <!-- SECCIÓN: DATOS DE EMBARQUE -->
                    <div class="shipment-card">
                        <div class="card-header">
                            <i class="fa fa-ship fa-lg"></i>
                            <h3>Datos de Embarque</h3>
                        </div>
                        <div class="card-body" id="shipment-info-form">
                            
                            <div class="modern-form-grid">
                                <!-- Documentación -->
                                <div class="form-group">
                                    <label><i class="fa fa-file-invoice"/> No. de Factura</label>
                                    <input type="text" id="h-invoice" class="form-control" placeholder="Ej. INV-2024-001"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-calendar"/> Fecha Embarque</label>
                                    <input type="date" id="h-date" class="form-control"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-file-contract"/> No. Proforma (PI)</label>
                                    <input type="text" id="h-proforma" class="form-control" placeholder="Ej. PI-9920"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-file-alt"/> No. B/L</label>
                                    <input type="text" id="h-bl" class="form-control" placeholder="Ej. COSU123456"/>
                                </div>

                                <!-- Logística -->
                                <div class="section-divider"><span>Logística</span></div>

                                <div class="form-group">
                                    <label><i class="fa fa-map-marker-alt"/> Origen (Puerto)</label>
                                    <input type="text" id="h-origin" class="form-control" placeholder="Ej. Shanghai"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-map-marker-alt"/> Destino (Puerto)</label>
                                    <input type="text" id="h-dest" class="form-control" placeholder="Ej. Manzanillo"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-globe"/> País Origen</label>
                                    <input type="text" id="h-country" class="form-control" placeholder="Ej. China"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-ship"/> Buque / Viaje</label>
                                    <input type="text" id="h-vessel" class="form-control" placeholder="Ej. MAERSK SEALAND"/>
                                </div>
                                
                                <div class="form-group">
                                    <label><i class="fa fa-handshake"/> Incoterm / Pago</label>
                                    <input type="text" id="h-incoterm" class="form-control" placeholder="Ej. CIF / T/T"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-info-circle"/> Estatus</label>
                                    <select id="h-status" class="form-control">
                                        <option value="">Seleccionar...</option>
                                        <option value="En Producción">En Producción</option>
                                        <option value="En Puerto Origen">En Puerto Origen</option>
                                        <option value="En Tránsito">En Tránsito</option>
                                        <option value="En Puerto Destino">En Puerto Destino</option>
                                    </select>
                                </div>

                                <!-- Carga -->
                                <div class="section-divider"><span>Detalles de Carga</span></div>

                                <div class="form-group">
                                    <label><i class="fa fa-box-open"/> No. Contenedor</label>
                                    <input type="text" id="h-cont-no" class="form-control" placeholder="Ej. MSKU1234567"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-lock"/> No. Sello</label>
                                    <input type="text" id="h-seal" class="form-control" placeholder="Ej. 123456"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-truck-loading"/> Tipo Contenedor</label>
                                    <input type="text" id="h-type" class="form-control" placeholder="Ej. 40HC, 20GP"/>
                                </div>
                                
                                <div class="form-group">
                                    <label><i class="fa fa-boxes"/> Total Paquetes</label>
                                    <input type="number" id="h-pkgs" class="form-control" placeholder="0"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-weight-hanging"/> Peso Bruto (kg)</label>
                                    <input type="number" step="0.01" id="h-weight" class="form-control" placeholder="0.00"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-cube"/> Volumen (m³)</label>
                                    <input type="number" step="0.01" id="h-volume" class="form-control" placeholder="0.00"/>
                                </div>

                                <div class="form-group full-width">
                                    <label><i class="fa fa-align-left"/> Descripción Mercancía</label>
                                    <textarea id="h-desc" class="form-control" rows="2" placeholder="Descripción general de la carga..."></textarea>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- TITULO PACKING LIST -->
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h4 class="text-white m-0"><i class="fa fa-list-ul me-2 text-warning"/> Detalle de Placas (Packing List)</h4>
                    </div>

                    <div class="alert alert-dark border border-secondary text-light mb-4" style="background: #1a1a1a;">
                        <small><i class="fa fa-info-circle text-warning me-1"/> Ingrese las dimensiones de cada placa. El área se calculará automáticamente.</small>
                    </div>

                    <!-- TABLAS JS -->
                    <div id="portal-rows-container">
                        <div class="text-center py-5 text-muted">
                            <i class="fa fa-circle-o-notch fa-spin fa-2x"></i>
                            <p class="mt-2">Cargando...</p>
                        </div>
                    </div>
                </div>

                <!-- FOOTER -->
                <div class="submit-footer">
                    <div class="summary">
                        Total Placas: <span id="total-plates">0</span> | 
                        Total Área: <span id="total-area">0.00</span> m²
                    </div>
                    <button id="btn-submit-pl" class="btn-primary-custom" disabled="disabled">
                        <i class="fa fa-paper-plane me-2"/> Guardar y Enviar
                    </button>
                </div>
            </div>
        </t>
    </template>

    <template id="portal_not_found">
        <t t-call="stock_lot_packing_import.portal_layout">
            <div class="container text-center py-5">
                <h1 class="display-1 text-danger">404</h1>
                <p class="lead">Enlace no válido.</p>
            </div>
        </t>
    </template>

    <template id="portal_expired">
        <t t-call="stock_lot_packing_import.portal_layout">
            <div class="container text-center py-5">
                <h1 class="display-1 text-warning"><i class="fa fa-clock-o"/></h1>
                <p class="lead">Este enlace ha expirado.</p>
            </div>
        </t>
    </template>
</odoo>```

## ./wizard/__init__.py
```py
# -*- coding: utf-8 -*-
from . import packing_list_import_wizard
from . import worksheet_import_wizard
from . import supplier_link_wizard
```

## ./wizard/packing_list_import_wizard.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields, _, api
from odoo.exceptions import UserError
import base64
import io
import json
import logging
import re

_logger = logging.getLogger(__name__)


class _PLCellsIndex:
    """Clase para normalizar el acceso a celdas de Odoo Spreadsheet"""
    
    def __init__(self):
        self._cells = {}

    def put(self, col, row, content, source="unknown"):
        if col is not None and row is not None:
            if content in (None, False, ""):
                if (int(col), int(row)) in self._cells:
                    _logger.info(f"[INDEX_DB] Limpiando celda [{col},{row}] por contenido vacío de {source}")
                    del self._cells[(int(col), int(row))]
            else:
                self._cells[(int(col), int(row))] = str(content)

    def ingest_cells(self, raw_cells):
        if not raw_cells:
            return
        _logger.info(f"[INDEX_DB] Cargando {len(raw_cells)} celdas del archivo base.")
        for key, cell_data in raw_cells.items():
            col, row = self._parse_cell_key(key)
            if col is not None and row is not None:
                content = self._extract_content(cell_data)
                if content:
                    self.put(col, row, content, source="snapshot")

    def _parse_cell_key(self, key):
        if isinstance(key, str) and key and key[0].isalpha():
            match = re.match(r'^([A-Z]+)(\d+)$', key.upper())
            if match:
                col_str, row_str = match.groups()
                col = 0
                for char in col_str:
                    col = col * 26 + (ord(char) - ord('A') + 1)
                return col - 1, int(row_str) - 1
        if isinstance(key, str) and ',' in key:
            parts = key.split(',')
            if len(parts) == 2:
                try: return int(parts[0]), int(parts[1])
                except: pass
        return None, None

    def _extract_content(self, cell_data):
        if isinstance(cell_data, dict):
            return cell_data.get('content') or cell_data.get('value') or cell_data.get('text') or ""
        return cell_data or ""

    def apply_revision_commands(self, commands, target_sheet_id):
        """Procesa comandos de edición y eliminación de filas"""
        applied = 0
        for cmd in commands:
            if isinstance(cmd, list):
                applied += self.apply_revision_commands(cmd, target_sheet_id)
                continue

            if cmd.get('sheetId') and cmd.get('sheetId') != target_sheet_id:
                continue
            
            cmd_type = cmd.get('type')
            
            if cmd_type == 'UPDATE_CELL':
                col, row = cmd.get('col'), cmd.get('row')
                if col is not None and row is not None:
                    content = self._extract_content(cmd)
                    self.put(col, row, content, source="UPDATE_CELL_REV")
                    applied += 1
            
            elif cmd_type == 'REMOVE_COLUMNS_ROWS':
                if cmd.get('dimension') == 'row':
                    elements = sorted(cmd.get('elements', []), reverse=True)
                    _logger.info(f"[INDEX_DB] Ejecutando eliminación de filas: {elements}")
                    for row_idx in elements:
                        self._shift_rows_up(row_idx)
                    applied += 1
                        
            elif cmd_type in ('DELETE_CONTENT', 'CLEAR_CELL'):
                zones = cmd.get('zones') or cmd.get('target') or []
                for zone in zones:
                    _logger.info(f"[INDEX_DB] Limpiando zona por DELETE_CONTENT: {zone}")
                    for r in range(zone.get('top', 0), zone.get('bottom', 0) + 1):
                        for c in range(zone.get('left', 0), zone.get('right', 0) + 1):
                            self.put(c, r, "", source="DELETE_REV")
                applied += 1
        return applied

    def _shift_rows_up(self, removed_row):
        """Mueve los datos hacia arriba cuando se elimina una fila"""
        new_cells = {}
        for (c, r), val in self._cells.items():
            if r < removed_row:
                new_cells[(c, r)] = val
            elif r > removed_row:
                new_cells[(c, r - 1)] = val
        self._cells = new_cells

    def value(self, col, row):
        return self._cells.get((int(col), int(row)))


class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List'

    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    spreadsheet_id = fields.Many2one('documents.document', related='picking_id.spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=False, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')

    def action_import_excel(self):
        self.ensure_one()
        _logger.info("=== [PL_IMPORT] INICIO PROCESO DE CARGA ===")
        
        rows = []
        if self.excel_file:
            rows = self._get_data_from_excel_file()
        elif self.spreadsheet_id:
            rows = self._get_data_from_spreadsheet()
        
        _logger.info(f"[PL_IMPORT] Resultado Final: {len(rows)} filas listas para importar.")

        if not rows:
            raise UserError("No se encontraron datos. Verifique que haya llenado el PL y que las medidas sean mayores a cero.")

        # --- LÓGICA DE LIMPIEZA PROFUNDA ---
        _logger.info("[PL_CLEANUP] Borrando datos previos...")
        old_move_lines = self.picking_id.move_line_ids
        old_lots = old_move_lines.mapped('lot_id')

        old_move_lines.write({'qty_done': 0})
        self.env.flush_all()
        if old_lots:
            quants = self.env['stock.quant'].sudo().search([('lot_id', 'in', old_lots.ids)])
            _logger.info(f"[PL_CLEANUP] Eliminando {len(quants)} quants.")
            quants.sudo().unlink()

        old_move_lines.unlink()
        for lot in old_lots:
            if self.env['stock.move.line'].search_count([('lot_id', '=', lot.id)]) == 0:
                try:
                    with self.env.cr.savepoint():
                        lot.unlink()
                except Exception as e:
                    _logger.warning(f"[PL_CLEANUP] No se pudo borrar lote {lot.name}: {e}")

        # --- CREACIÓN DE NUEVOS REGISTROS ---
        move_lines_created = 0
        next_prefix = self._get_next_global_prefix()
        containers = {}

        for data in rows:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move: continue

            cont = data['contenedor'] or 'SN'
            if cont not in containers:
                containers[cont] = {'pre': str(next_prefix), 'num': self._get_next_lot_number_for_prefix(str(next_prefix))}
                next_prefix += 1

            l_name = f"{containers[cont]['pre']}-{containers[cont]['num']:02d}"
            
            grupo_ids = []
            if data.get('grupo_name'):
                grupo = self.env['stock.lot.group'].search([('name', '=', data['grupo_name'].strip())], limit=1)
                if not grupo: grupo = self.env['stock.lot.group'].create({'name': data['grupo_name'].strip()})
                grupo_ids = [grupo.id]

            lot = self.env['stock.lot'].create({
                'name': l_name, 'product_id': product.id, 'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'], 'x_alto': data['alto'], 'x_ancho': data['ancho'],
                'x_color': data.get('color'), 'x_bloque': data['bloque'], 'x_atado': data['atado'],
                'x_tipo': data['tipo'], 'x_grupo': [(6, 0, grupo_ids)], 'x_pedimento': data['pedimento'],
                'x_contenedor': cont, 'x_referencia_proveedor': data['ref_proveedor'],
            })
            
            self.env['stock.move.line'].create({
                'move_id': move.id, 'product_id': product.id, 'lot_id': lot.id,
                'qty_done': round(data['alto'] * data['ancho'], 3) or 1.0,
                'location_id': self.picking_id.location_id.id, 'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id, 'x_grosor_temp': data['grosor'], 'x_alto_temp': data['alto'],
                'x_ancho_temp': data['ancho'], 'x_color_temp': data.get('color'), 'x_tipo_temp': data['tipo'],
                'x_bloque_temp': data['bloque'], 'x_atado_temp': data['atado'], 'x_pedimento_temp': data['pedimento'],
                'x_contenedor_temp': cont, 'x_referencia_proveedor_temp': data['ref_proveedor'], 'x_grupo_temp': [(6, 0, grupo_ids)],
            })
            containers[cont]['num'] += 1
            move_lines_created += 1

        self.picking_id.write({'packing_list_imported': True})
        _logger.info(f"=== [PL_IMPORT] PROCESO TERMINADO. Creados {move_lines_created} registros. ===")
        return {
            'type': 'ir.actions.client', 'tag': 'display_notification',
            'params': {
                'title': 'PL Procesado', 'message': f'Se han importado/corregido {move_lines_created} lotes.',
                'type': 'success', 'next': {'type': 'ir.actions.act_window_close'}
            }
        }

    def _get_data_from_spreadsheet(self):
        doc = self.spreadsheet_id
        
        spreadsheet_json = self._get_current_spreadsheet_state(doc)
        if not spreadsheet_json or not spreadsheet_json.get('sheets'):
            return []

        all_rows = []
        for sheet in spreadsheet_json['sheets']:
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            
            product = self._identify_product_from_sheet(idx)
            if product:
                sheet_rows = self._extract_rows_from_index(idx, product)
                all_rows.extend(sheet_rows)
        return all_rows

    def _get_current_spreadsheet_state(self, doc):
        """Obtiene el estado ACTUAL del spreadsheet usando el mismo método que el frontend"""
        
        # Método 1: Usar spreadsheet_snapshot (el snapshot más reciente)
        if doc.spreadsheet_snapshot:
            try:
                data = doc.spreadsheet_snapshot
                parsed = json.loads(data.decode('utf-8') if isinstance(data, bytes) else data)
                if parsed and parsed.get('sheets'):
                    cells_count = sum(len(s.get('cells', {})) for s in parsed['sheets'])
                    _logger.info(f"[PL_IMPORT] Usando spreadsheet_snapshot ({cells_count} celdas)")
                    return self._apply_pending_revisions(doc, parsed)
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error leyendo spreadsheet_snapshot: {e}")
        
        # Método 2: Usar _get_spreadsheet_serialized_snapshot (método interno de Odoo)
        try:
            if hasattr(doc, '_get_spreadsheet_serialized_snapshot'):
                snapshot_data = doc._get_spreadsheet_serialized_snapshot()
                if snapshot_data:
                    parsed = json.loads(snapshot_data) if isinstance(snapshot_data, str) else snapshot_data
                    if parsed and parsed.get('sheets'):
                        cells_count = sum(len(s.get('cells', {})) for s in parsed['sheets'])
                        _logger.info(f"[PL_IMPORT] Usando _get_spreadsheet_serialized_snapshot ({cells_count} celdas)")
                        return self._apply_pending_revisions(doc, parsed)
        except Exception as e:
            _logger.warning(f"[PL_IMPORT] Error en _get_spreadsheet_serialized_snapshot: {e}")
        
        # Método 3: Fallback a spreadsheet_data + todas las revisiones
        _logger.info("[PL_IMPORT] Fallback: spreadsheet_data + todas las revisiones")
        return self._load_spreadsheet_with_all_revisions(doc)

    def _apply_pending_revisions(self, doc, spreadsheet_json):
        """Aplica revisiones pendientes después del último snapshot"""
        
        snapshot_revision_id = spreadsheet_json.get('revisionId', '')
        _logger.info(f"[PL_DEBUG] Snapshot revisionId: '{snapshot_revision_id}'")
        
        if not snapshot_revision_id:
            return spreadsheet_json
        
        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'), 
            ('res_id', '=', doc.id)
        ], order='id asc')
        
        # Encontrar revisiones después del snapshot actual
        start_applying = False
        all_cmds = []
        
        for rev in revisions:
            rev_data = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
            
            if not start_applying:
                rev_id = rev_data.get('id') if isinstance(rev_data, dict) else None
                if rev_id == snapshot_revision_id:
                    start_applying = True
                continue
            
            # Saltar SNAPSHOT_CREATED
            if isinstance(rev_data, dict) and rev_data.get('type') == 'SNAPSHOT_CREATED':
                continue
                
            if isinstance(rev_data, dict) and 'commands' in rev_data:
                all_cmds.extend(rev_data['commands'])
            elif isinstance(rev_data, list):
                all_cmds.extend(rev_data)
        
        if not all_cmds:
            _logger.info("[PL_IMPORT] No hay revisiones pendientes después del snapshot")
            return spreadsheet_json
        
        _logger.info(f"[PL_IMPORT] Aplicando {len(all_cmds)} comandos pendientes")
        
        for sheet in spreadsheet_json.get('sheets', []):
            sheet_id = sheet.get('id')
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            idx.apply_revision_commands(all_cmds, sheet_id)
            sheet['cells'] = {f"{self._col_to_letter(c)}{r+1}": {'content': v} 
                             for (c, r), v in idx._cells.items()}
        
        return spreadsheet_json

    def _load_spreadsheet_with_all_revisions(self, doc):
        """Carga spreadsheet_data y aplica TODAS las revisiones desde el inicio"""
        spreadsheet_json = self._load_spreadsheet_json(doc)
        if not spreadsheet_json:
            return None
        
        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'), 
            ('res_id', '=', doc.id)
        ], order='id asc')
        
        _logger.info(f"[PL_DEBUG] Total revisiones: {len(revisions)}")
        
        all_cmds = []
        for rev in revisions:
            rev_data = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
            
            # Saltar SNAPSHOT_CREATED (no tienen comandos útiles)
            if isinstance(rev_data, dict) and rev_data.get('type') == 'SNAPSHOT_CREATED':
                continue
                
            if isinstance(rev_data, dict) and 'commands' in rev_data:
                all_cmds.extend(rev_data['commands'])
            elif isinstance(rev_data, list):
                all_cmds.extend(rev_data)
        
        _logger.info(f"[PL_IMPORT] Aplicando {len(all_cmds)} comandos totales")
        
        cmd_types = {}
        for cmd in all_cmds:
            if isinstance(cmd, dict):
                t = cmd.get('type', 'UNKNOWN')
                cmd_types[t] = cmd_types.get(t, 0) + 1
        _logger.info(f"[PL_DEBUG] Tipos de comandos: {cmd_types}")
        
        for sheet in spreadsheet_json.get('sheets', []):
            sheet_id = sheet.get('id')
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            
            _logger.info(f"[PL_DEBUG] Sheet {sheet_id}: {len(idx._cells)} celdas antes")
            applied = idx.apply_revision_commands(all_cmds, sheet_id)
            _logger.info(f"[PL_DEBUG] Sheet {sheet_id}: {applied} aplicados, {len(idx._cells)} celdas después")
            
            sheet['cells'] = {f"{self._col_to_letter(c)}{r+1}": {'content': v} 
                             for (c, r), v in idx._cells.items()}
        
        return spreadsheet_json

    def _col_to_letter(self, col):
        """Convierte índice de columna (0-based) a letra(s)"""
        result = ""
        col += 1
        while col:
            col, remainder = divmod(col - 1, 26)
            result = chr(65 + remainder) + result
        return result

    def _identify_product_from_sheet(self, idx):
        p_info = None
        for r in range(3):
            label = str(idx.value(0, r) or "").upper()
            if "PRODUCTO:" in label:
                p_info = idx.value(1, r)
                break
        if not p_info: p_info = idx.value(1, 0)
        
        if not p_info: return None
        p_name = str(p_info).split('(')[0].strip()
        _logger.info(f"[PL_IMPORT] Producto detectado: '{p_name}'")
        return self.env['product.product'].search(['|', ('name', '=', p_name), ('default_code', '=', p_name)], limit=1)

    def _extract_rows_from_index(self, idx, product):
        rows = []
        for r in range(3, 200):
            alto = self._to_float(idx.value(1, r))
            ancho = self._to_float(idx.value(2, r))
            
            if alto > 0 and ancho > 0:
                rows.append({
                    'product': product, 'grosor': self._to_float(idx.value(0, r)),
                    'alto': alto, 'ancho': ancho, 'color': str(idx.value(3, r) or '').strip(),
                    'bloque': str(idx.value(4, r) or '').strip(), 'atado': str(idx.value(5, r) or '').strip(),
                    'tipo': self._parse_tipo(idx.value(6, r)), 'grupo_name': str(idx.value(7, r) or '').strip(),
                    'pedimento': str(idx.value(8, r) or '').strip(), 'contenedor': str(idx.value(9, r) or 'SN').strip(),
                    'ref_proveedor': str(idx.value(10, r) or '').strip(),
                })
                _logger.info(f"[PL_EXTRACT] Fila {r+1} procesada OK.")
            else:
                if idx.value(0, r) or idx.value(4, r):
                    _logger.info(f"[PL_EXTRACT] Fila {r+1} descartada (Alto: {alto}, Ancho: {ancho})")
        return rows

    def _to_float(self, val):
        if not val: return 0.0
        try: return float(str(val).replace(',', '.').strip())
        except: return 0.0

    def _parse_tipo(self, val):
        v = str(val or '').lower().strip()
        return 'formato' if v == 'formato' else 'placa'

    def _get_next_global_prefix(self):
        self.env.cr.execute("""SELECT CAST(SUBSTRING(name FROM '^([0-9]+)-') AS INTEGER) as prefix_num FROM stock_lot WHERE name ~ '^[0-9]+-[0-9]+$' AND company_id = %s ORDER BY prefix_num DESC LIMIT 1""", (self.picking_id.company_id.id,))
        res = self.env.cr.fetchone()
        return (res[0] + 1) if res and res[0] else 1

    def _get_next_lot_number_for_prefix(self, prefix):
        self.env.cr.execute("""SELECT name FROM stock_lot WHERE name LIKE %s AND company_id = %s ORDER BY CAST(SUBSTRING(name FROM '-([0-9]+)$') AS INTEGER) DESC LIMIT 1""", (f'{prefix}-%', self.picking_id.company_id.id))
        res = self.env.cr.fetchone()
        return int(res[0].split('-')[1]) + 1 if res else 1

    def _load_spreadsheet_json(self, doc):
        if doc.spreadsheet_data:
            try:
                data = doc.spreadsheet_data
                return json.loads(data.decode('utf-8') if isinstance(data, bytes) else data)
            except: pass
        return None

    def _get_data_from_excel_file(self):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info: continue
            product = self.env['product.product'].search([('name', 'ilike', str(p_info).split('(')[0].strip())], limit=1)
            if not product: continue
            for r in range(4, sheet.max_row + 1):
                alto, ancho = self._to_float(sheet.cell(r, 2).value), self._to_float(sheet.cell(r, 3).value)
                if alto > 0 and ancho > 0:
                    rows.append({
                        'product': product, 'grosor': self._to_float(sheet.cell(r, 1).value),
                        'alto': alto, 'ancho': ancho, 'color': str(sheet.cell(r, 4).value or '').strip(),
                        'bloque': str(sheet.cell(r, 5).value or '').strip(), 'atado': str(sheet.cell(r, 6).value or '').strip(),
                        'tipo': self._parse_tipo(sheet.cell(r, 7).value), 'grupo_name': str(sheet.cell(r, 8).value or '').strip(),
                        'pedimento': str(sheet.cell(r, 9).value or '').strip(), 'contenedor': str(sheet.cell(r, 10).value or 'SN').strip(),
                        'ref_proveedor': str(sheet.cell(r, 11).value or '').strip(),
                    })
        return rows```

## ./wizard/packing_list_import_wizard_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_packing_list_import_wizard_form" model="ir.ui.view">
        <field name="name">packing.list.import.wizard.form</field>
        <field name="model">packing.list.import.wizard</field>
        <field name="arch" type="xml">
            <form>
                <sheet>
                    <!-- Campo invisible para controlar la lógica visual -->
                    <field name="spreadsheet_id" invisible="1"/>
                    
                    <group>
                        <field name="picking_id" readonly="1"/>
                        
                        <!-- Mostramos el cargador de archivos SOLO si NO hay Spreadsheet -->
                        <field name="excel_filename" invisible="1"/>
                        <field name="excel_file" filename="excel_filename" 
                               invisible="spreadsheet_id != False" 
                               required="spreadsheet_id == False"/>
                    </group>

                    <group>
                        <!-- Mensaje informativo cuando se usa Spreadsheet -->
                        <div class="alert alert-success" role="alert" invisible="spreadsheet_id == False">
                            <p><strong><i class="fa fa-table"></i> Hoja de Cálculo detectada:</strong></p>
                            <p>El sistema procesará los datos que ingresaste en la plantilla nativa de Odoo. No es necesario subir ningún archivo.</p>
                        </div>

                        <!-- Instrucciones cuando se usa Archivo Excel -->
                        <div class="alert alert-info" role="alert" invisible="spreadsheet_id != False">
                            <p><strong>Instrucciones:</strong></p>
                            <ul>
                                <li>Suba el archivo Excel del Packing List.</li>
                                <li>Los lotes se crearán automáticamente con numeración secuencial.</li>
                            </ul>
                        </div>
                    </group>
                </sheet>
                <footer>
                    <button string="Procesar e Importar" name="action_import_excel" type="object" class="btn-primary"/>
                    <button string="Cancelar" class="btn-secondary" special="cancel"/>
                </footer>
            </form>
        </field>
    </record>
</odoo>```

## ./wizard/supplier_link_wizard.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class PurchaseSupplierPortalLinkWizard(models.TransientModel):
    _name = 'purchase.supplier.portal.link.wizard'
    _description = 'Wizard: Copiar Link Portal Proveedor'

    purchase_id = fields.Many2one('purchase.order', string='Orden de Compra', required=True, readonly=True)
    access_id = fields.Many2one('stock.picking.supplier.access', string='Acceso', readonly=True)

    portal_url = fields.Char(string='Link', readonly=True)
    expiration_date = fields.Datetime(string='Expira', readonly=True)
    picking_id = fields.Many2one('stock.picking', string='Recepción', readonly=True)

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        purchase_id = res.get('purchase_id') or self.env.context.get('default_purchase_id')
        if not purchase_id:
            return res

        po = self.env['purchase.order'].browse(purchase_id).exists()
        if not po:
            return res

        if po.state not in ['purchase', 'done']:
            raise UserError(_("Debe confirmar la Orden de Compra antes de generar el link."))

        target_picking = po._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        access = po._get_or_create_supplier_access(target_picking)

        res.update({
            'access_id': access.id,
            'portal_url': access.portal_url,
            'expiration_date': access.expiration_date,
            'picking_id': access.picking_id.id,
        })
        return res

    def action_refresh(self):
        """Refresca picking vigente y renueva expiración manteniendo el mismo token."""
        self.ensure_one()
        po = self.purchase_id
        target_picking = po._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        access = po._get_or_create_supplier_access(target_picking)

        self.write({
            'access_id': access.id,
            'portal_url': access.portal_url,
            'expiration_date': access.expiration_date,
            'picking_id': access.picking_id.id,
        })

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Link actualizado'),
                'message': _('Se renovó la vigencia y se apuntó a la recepción vigente. El link NO cambió.'),
                'type': 'success',
                'sticky': False,
            }
        }
```

## ./wizard/supplier_link_wizard_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_purchase_supplier_portal_link_wizard_form" model="ir.ui.view">
        <field name="name">purchase.supplier.portal.link.wizard.form</field>
        <field name="model">purchase.supplier.portal.link.wizard</field>
        <field name="arch" type="xml">
            <form string="Link Portal Proveedor">
                <sheet>
                    <group>
                        <field name="purchase_id" readonly="1"/>
                        <field name="picking_id" readonly="1"/>
                        <field name="expiration_date" readonly="1"/>
                    </group>

                    <group>
                        <!-- Copia con widget -->
                        <field name="portal_url" readonly="1" widget="CopyClipboardChar"/>
                    </group>

                    <div class="alert alert-info" role="alert">
                        Este link es único por Orden de Compra. Si vuelve a generar/abrir, se reutiliza el mismo token.
                    </div>
                </sheet>
                <footer>
                    <button string="Renovar vigencia / Actualizar recepción"
                            type="object"
                            name="action_refresh"
                            class="btn-primary"/>
                    <button string="Cerrar" special="cancel" class="btn-secondary"/>
                </footer>
            </form>
        </field>
    </record>
</odoo>
```

## ./wizard/worksheet_import_wizard.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import base64
import io
import json
import logging

_logger = logging.getLogger(__name__)

class WorksheetImportWizard(models.TransientModel):
    _name = 'worksheet.import.wizard'
    _description = 'Importar Worksheet (Spreadsheet WS o Excel)'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    ws_spreadsheet_id = fields.Many2one('documents.document', related='picking_id.ws_spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel (Opcional)', attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def action_import_worksheet(self):
        self.ensure_one()
        
        if self.picking_id.picking_type_code != 'incoming':
            raise UserError('Solo se puede importar en recepciones.')

        if self.picking_id.state == 'done':
            raise UserError('La recepción ya está validada. No se puede procesar el Worksheet sobre lotes históricos.')

        if not self.ws_spreadsheet_id and not self.excel_file:
            raise UserError('No se encontró el Spreadsheet del Worksheet ni se subió un archivo Excel.')

        rows_data = []
        if self.excel_file:
            rows_data = self._get_data_from_excel()
        else:
            rows_data = self._get_data_from_spreadsheet()

        if not rows_data:
            raise UserError('No se encontraron datos de medidas reales (Alto/Ancho Real) para procesar.')

        lines_updated = 0
        total_missing_pieces = 0
        total_missing_m2 = 0
        
        # Diccionario para agrupar lotes que SÍ llegaron por contenedor
        container_lots = {}
        # Lista de lotes a eliminar (los que tienen medidas en 0)
        lots_to_delete = []
        move_lines_to_delete = []

        for data in rows_data:
            product = data['product']
            lot_name = data['lot_name']

            move_line = self.env['stock.move.line'].search([
                ('picking_id', '=', self.picking_id.id),
                ('product_id', '=', product.id),
                ('lot_id.name', '=', lot_name)
            ], limit=1)

            if not move_line or not move_line.lot_id:
                _logger.warning(f"No se encontró el lote '{lot_name}' para el producto {product.name} en esta recepción.")
                continue

            lot = move_line.lot_id
            alto_real = data['alto_real']
            ancho_real = data['ancho_real']

            # CASO A: Material que NO llegó (Medidas en 0)
            if alto_real == 0.0 and ancho_real == 0.0:
                m2_faltante = lot.x_alto * lot.x_ancho if lot.x_alto and lot.x_ancho else 0
                total_missing_pieces += 1
                total_missing_m2 += m2_faltante
                
                # Guardar para eliminar después
                move_lines_to_delete.append(move_line)
                lots_to_delete.append(lot)
            
            # CASO B: Material que llegó (Se actualizan medidas reales)
            else:
                lot.write({
                    'x_alto': alto_real,
                    'x_ancho': ancho_real
                })
                move_line.write({
                    'qty_done': round(alto_real * ancho_real, 3),
                    'x_alto_temp': alto_real,
                    'x_ancho_temp': ancho_real,
                })
                
                cont = lot.x_contenedor or 'SN'
                if cont not in container_lots:
                    container_lots[cont] = []
                container_lots[cont].append({
                    'lot': lot,
                    'original_name': lot.name,
                    'move_line': move_line
                })
                lines_updated += 1

        # ELIMINAR LOTES QUE NO LLEGARON
        # Primero poner qty_done = 0 para evitar que Odoo cree/mantenga quants
        for ml in move_lines_to_delete:
            ml.write({'qty_done': 0})
        
        # Eliminar los quants asociados a los lotes
        for lot in lots_to_delete:
            quants = self.env['stock.quant'].sudo().search([('lot_id', '=', lot.id)])
            if quants:
                # Forzar eliminación de quants (solo funciona si qty=0 o reservado=0)
                quants.sudo().write({'quantity': 0, 'reserved_quantity': 0})
                quants.sudo().unlink()
        
        # Eliminar move_lines
        for ml in move_lines_to_delete:
            ml.unlink()
        
        # Eliminar lotes (solo si no tienen otras operaciones asociadas)
        for lot in lots_to_delete:
            other_ops = self.env['stock.move.line'].search([('lot_id', '=', lot.id)])
            if not other_ops:
                # Verificar que no queden quants
                remaining_quants = self.env['stock.quant'].sudo().search([('lot_id', '=', lot.id)])
                if remaining_quants:
                    remaining_quants.sudo().unlink()
                lot.unlink()

        # RENUMERACIÓN SECUENCIAL de los lotes que SÍ llegaron
        for cont, lot_data_list in container_lots.items():
            if not lot_data_list:
                continue
            
            # Ordenar por el nombre original para mantener el orden
            lot_data_list.sort(key=lambda x: x['original_name'])
            
            # Extraer prefijo del primer lote (ej: "100" de "100-01")
            first_name = lot_data_list[0]['original_name']
            prefix = first_name.split('-')[0] if '-' in first_name else "1"
            
            # Renumerar secuencialmente
            for idx, lot_data in enumerate(lot_data_list, start=1):
                new_name = f"{prefix}-{idx:02d}"
                lot_data['lot'].write({'name': new_name})

        # Marcar Worksheet como procesado
        self.picking_id.write({'worksheet_imported': True})

        # Notificación
        message = f'✓ Se actualizaron {lines_updated} lotes con medidas reales.'
        if total_missing_pieces > 0:
            message += f'\n⚠️ MATERIAL FALTANTE:\n• Piezas eliminadas: {total_missing_pieces}\n• Total m² reducidos: {total_missing_m2:.2f} m²'

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Worksheet Procesado Correctamente',
                'message': message,
                'type': 'warning' if total_missing_pieces > 0 else 'success',
                'sticky': True if total_missing_pieces > 0 else False,
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }

    def _get_data_from_spreadsheet(self):
        """Lee el documento ws_spreadsheet_id (Worksheet) detectando cambios manuales"""
        pl_wizard = self.env['packing.list.import.wizard'].create({'picking_id': self.picking_id.id})
        doc = self.ws_spreadsheet_id 
        
        data = pl_wizard._load_spreadsheet_json(doc)
        if not data: return []

        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'), ('res_id', '=', doc.id)
        ], order='id asc')

        from .packing_list_import_wizard import _PLCellsIndex
        
        all_rows = []
        for sheet in data.get('sheets', []):
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            
            for rev in revisions:
                try:
                    cmds = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
                    if isinstance(cmds, dict) and cmds.get('type') == 'REMOTE_REVISION':
                        idx.apply_revision_commands(cmds.get('commands', []), sheet.get('id'))
                except: continue
            
            product = pl_wizard._identify_product_from_sheet(idx)
            if not product: continue

            # Col A (0) = Nombre del Lote
            # Col M (12) = Alto Real
            # Col N (13) = Ancho Real
            for r in range(3, 250):
                lot_name = str(idx.value(0, r) or '').strip()
                if not lot_name or lot_name == 'Nº Lote': continue

                alto_r = self._to_float(idx.value(12, r))
                ancho_r = self._to_float(idx.value(13, r))
                
                # Incluir TODOS los lotes encontrados (con o sin medidas)
                all_rows.append({
                    'product': product,
                    'lot_name': lot_name,
                    'alto_real': alto_r,
                    'ancho_real': ancho_r,
                })
                    
        return all_rows

    def _get_data_from_excel(self):
        """Lógica para leer el archivo Excel del Worksheet"""
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise UserError('Instale openpyxl')
            
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        all_rows = []
        
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info: continue
            
            p_code = str(p_info).split('(')[1].split(')')[0].strip() if '(' in str(p_info) else ''
            product = self.env['product.product'].search([
                '|', ('default_code', '=', p_code), ('name', '=', str(p_info).split('(')[0].strip())
            ], limit=1)
            
            if not product: continue

            for r in range(4, sheet.max_row + 1):
                lot_name = str(sheet.cell(r, 1).value or '').strip()
                if not lot_name: continue
                
                all_rows.append({
                    'product': product,
                    'lot_name': lot_name,
                    'alto_real': self._to_float(sheet.cell(r, 14).value),
                    'ancho_real': self._to_float(sheet.cell(r, 15).value),
                })
        return all_rows

    def _to_float(self, val):
        if val is None or val == '': return 0.0
        try:
            return float(str(val).replace(',', '.'))
        except:
            return 0.0```

## ./wizard/worksheet_import_wizard_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_worksheet_import_wizard_form" model="ir.ui.view">
        <field name="name">worksheet.import.wizard.form</field>
        <field name="model">worksheet.import.wizard</field>
        <field name="arch" type="xml">
            <form>
                <sheet>
                    <field name="ws_spreadsheet_id" invisible="1"/>
                    <group>
                        <field name="picking_id" readonly="1"/>
                        <field name="excel_filename" invisible="1"/>
                        <field name="excel_file" filename="excel_filename" 
                               invisible="ws_spreadsheet_id != False"/>
                    </group>
                    
                    <div class="alert alert-success" role="alert" invisible="ws_spreadsheet_id == False">
                        <p><strong><i class="fa fa-table"></i> Spreadsheet Detectado:</strong></p>
                        <p>El sistema leerá las columnas <strong>"ALTO REAL (m)"</strong> y <strong>"ANCHO REAL (m)"</strong> directamente de tu hoja de cálculo activa.</p>
                        <p>Asegúrate de haber guardado los cambios en el Spreadsheet antes de procesar.</p>
                    </div>

                    <div class="alert alert-info" role="alert" invisible="ws_spreadsheet_id != False">
                        <p>Sube el archivo Excel con las medidas reales si no estás usando la hoja de cálculo de Odoo.</p>
                    </div>
                </sheet>
                <footer>
                    <button string="Actualizar Medidas Reales" name="action_import_worksheet" type="object" class="btn-primary"/>
                    <button string="Cancelar" class="btn-secondary" special="cancel"/>
                </footer>
            </form>
        </field>
    </record>
</odoo>```

