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
        'views/purchase_order_views.xml', # NUEVO: Vista de Compras
        'views/stock_picking_views.xml',
        'views/supplier_portal_templates.xml',
    ],
    'assets': {
        'web.assets_frontend': [
            'stock_lot_packing_import/static/src/scss/supplier_portal.scss',
            'stock_lot_packing_import/static/src/xml/supplier_portal.xml',
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
from odoo import http
from odoo.http import request
import json

class SupplierPortalController(http.Controller):

    @http.route('/supplier/pl/<string:token>', type='http', auth='public')
    def view_supplier_portal(self, token, **kwargs):
        access = request.env['stock.picking.supplier.access'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        # Corrección de nombre de módulo en render
        if not access:
            return request.render('stock_lot_packing_import.portal_not_found')
        if access.is_expired:
            return request.render('stock_lot_packing_import.portal_expired')

        # Datos iniciales para el JS
        picking = access.picking_id
        products = []
        for move in picking.move_ids:
            products.append({
                'id': move.product_id.id,
                'name': move.product_id.name,
                'code': move.product_id.default_code or '',
                'qty_ordered': move.product_uom_qty,
                'uom': move.product_uom.name
            })

        # Corrección de nombre de módulo en render
        return request.render('stock_lot_packing_import.supplier_portal_view', {
            'picking': picking,
            'products_json': json.dumps(products),
            'token': token,
            'company': picking.company_id
        })

    # Corrección type='jsonrpc' para Odoo 19
    @http.route('/supplier/pl/submit', type='jsonrpc', auth='public')
    def submit_pl_data(self, token, rows):
        access = request.env['stock.picking.supplier.access'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not access or access.is_expired:
            return {'success': False, 'message': 'Token inválido o expirado.'}

        picking = access.picking_id
        if picking.state in ['done', 'cancel']:
             return {'success': False, 'message': 'La recepción ya fue procesada.'}

        try:
            picking.process_external_pl_data(rows)
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
from odoo import models, fields, api, _
from odoo.exceptions import UserError

class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    supplier_access_ids = fields.One2many('stock.picking.supplier.access', 'purchase_id', string="Links Proveedor")

    def action_generate_supplier_link(self):
        """ 
        Busca la recepción (picking) pendiente asociada a esta PO y genera el link.
        """
        self.ensure_one()
        
        if self.state not in ['purchase', 'done']:
            raise UserError("Debe confirmar la Orden de Compra antes de enviar el link al proveedor.")

        # Buscar recepciones pendientes (no canceladas ni validadas) asociadas a esta PO
        pickings = self.picking_ids.filtered(
            lambda p: p.state not in ('done', 'cancel') and p.picking_type_code == 'incoming'
        )

        if not pickings:
            raise UserError("No se encontraron recepciones pendientes para esta Orden de Compra. Verifique que no hayan sido validadas o canceladas.")

        # Tomamos la primera recepción disponible (usualmente la principal o el backorder actual)
        target_picking = pickings[0]

        # Crear el acceso vinculado a la recepción y a la PO
        access = self.env['stock.picking.supplier.access'].create({
            'picking_id': target_picking.id,
            'purchase_id': self.id
        })

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Link Generado para Proveedor',
                'message': f'Link creado para recepción {target_picking.name}: {access.portal_url}',
                'type': 'success',
                'sticky': True,
            }
        }```

## ./models/stock_picking.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import io
import base64
import logging
import json

_logger = logging.getLogger(__name__)

class StockPicking(models.Model):
    _inherit = 'stock.picking'
    
    # --- Campos de Packing List (PL) ---
    packing_list_file = fields.Binary(string='Packing List (Archivo)', attachment=True, copy=False)
    packing_list_filename = fields.Char(string='Nombre del archivo', copy=False)
    spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet Packing List', copy=False)
    has_packing_list = fields.Boolean(string='Tiene Packing List', compute='_compute_has_packing_list', store=True)
    packing_list_imported = fields.Boolean(string='Packing List Importado', default=False, copy=False)
    
    # --- Campos para el Worksheet (WS) ---
    ws_spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet Worksheet', copy=False)
    worksheet_file = fields.Binary(string='Worksheet Exportado', attachment=True, copy=False)
    worksheet_filename = fields.Char(string='Nombre del Worksheet', copy=False)
    worksheet_imported = fields.Boolean(string='Worksheet Importado', default=False, copy=False)

    # --- NUEVO: Acceso a Portal Proveedor (Solo lectura/informativo en Picking) ---
    supplier_access_ids = fields.One2many('stock.picking.supplier.access', 'picking_id', string="Links Proveedor")
    
    @api.depends('packing_list_file', 'spreadsheet_id', 'supplier_access_ids')
    def _compute_has_packing_list(self):
        for rec in self:
            # Se considera que tiene PL si hay un archivo, un spreadsheet generado o un link de proveedor creado
            rec.has_packing_list = bool(rec.packing_list_file or rec.spreadsheet_id or rec.supplier_access_ids)

    # -------------------------------------------------------------------------
    # FUNCIONALIDAD PORTAL PROVEEDOR (PROCESAMIENTO)
    # NOTA: La generación del link se movió a purchase.order
    # -------------------------------------------------------------------------

    def process_external_pl_data(self, json_data):
        """ 
        Recibe la data JSON desde el portal del proveedor y crea los lotes.
        Esta función es llamada por el Controlador cuando el proveedor envía el formulario.
        """
        self.ensure_one()
        _logger.info(f"Procesando PL Externo para {self.name} con {len(json_data)} registros.")

        # 1. Limpieza de datos previos (Borrar y reescribir para evitar duplicados)
        old_move_lines = self.move_line_ids
        old_lots = old_move_lines.mapped('lot_id')

        # Resetear cantidades hechas
        old_move_lines.write({'qty_done': 0})
        
        # Eliminar Quants fantasmas si existen
        if old_lots:
            quants = self.env['stock.quant'].sudo().search([('lot_id', 'in', old_lots.ids)])
            quants.sudo().unlink()

        # Eliminar lineas viejas
        old_move_lines.unlink()
        
        # Eliminar lotes huérfanos creados anteriormente para esta operación
        for lot in old_lots:
            # Verificar si el lote se usa en otros movimientos fuera de este picking
            if self.env['stock.move.line'].search_count([('lot_id', '=', lot.id)]) == 0:
                try:
                    lot.unlink()
                except Exception as e:
                    _logger.warning(f"No se pudo eliminar lote {lot.name}: {e}")

        # 2. Lógica de Prefijos y Contenedores
        # Buscamos el último prefijo numérico global (Ej: si el ultimo fue 104-XX, el siguiente es 105)
        self.env.cr.execute("""SELECT CAST(SUBSTRING(name FROM '^([0-9]+)-') AS INTEGER) as prefix_num FROM stock_lot WHERE name ~ '^[0-9]+-[0-9]+$' AND company_id = %s ORDER BY prefix_num DESC LIMIT 1""", (self.company_id.id,))
        res = self.env.cr.fetchone()
        next_prefix = (res[0] + 1) if res and res[0] else 1
        
        containers_map = {} # Mapa para controlar prefijos por contenedor: {'CONT1': {'prefix': '105', 'seq': 1}}
        move_lines_created = 0

        # 3. Procesamiento de filas
        for row in json_data:
            # Validar producto
            try:
                product_id = int(row.get('product_id'))
                product = self.env['product.product'].browse(product_id)
            except (ValueError, TypeError):
                continue

            if not product.exists(): 
                continue
            
            # Buscar el movimiento original (Stock Move) para asociar
            move = self.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move: 
                continue

            # Gestión de Contenedor y Numeración
            cont_raw = (row.get('contenedor') or 'SN').strip().upper()
            
            if cont_raw not in containers_map:
                containers_map[cont_raw] = {
                    'prefix': str(next_prefix), 
                    'seq': 1 
                }
                next_prefix += 1 # Siguiente contenedor tendrá siguiente prefijo numérico global
            
            # Generar Nombre Lote: PREFIJO-CONSECUTIVO (Ej: 105-01)
            current_prefix = containers_map[cont_raw]['prefix']
            current_seq = containers_map[cont_raw]['seq']
            l_name = f"{current_prefix}-{current_seq:02d}"
            
            # Parsear valores numéricos
            try:
                grosor = float(row.get('grosor', 0))
                alto = float(row.get('alto', 0))
                ancho = float(row.get('ancho', 0))
            except ValueError:
                grosor = alto = ancho = 0.0

            # Crear Lote
            lot_vals = {
                'name': l_name, 
                'product_id': product.id, 
                'company_id': self.company_id.id,
                'x_grosor': grosor, 
                'x_alto': alto, 
                'x_ancho': ancho,
                'x_color': row.get('color', ''), 
                'x_bloque': row.get('bloque', ''), 
                'x_tipo': row.get('tipo', 'placa'), 
                'x_contenedor': cont_raw, 
                # 'x_referencia_proveedor': row.get('ref_prov', ''), # Descomentar si tu modelo lo tiene
            }
            lot = self.env['stock.lot'].create(lot_vals)
            
            # Calcular cantidad (M2)
            qty = round(alto * ancho, 3)
            if qty <= 0: qty = 1.0

            # Crear Move Line (Asignación al Picking)
            self.env['stock.move.line'].create({
                'move_id': move.id, 
                'product_id': product.id, 
                'lot_id': lot.id,
                'qty_done': qty,
                'location_id': self.location_id.id, 
                'location_dest_id': self.location_dest_id.id,
                'picking_id': self.id,
                # Campos temp para trazabilidad (si tu modulo base los usa)
                'x_grosor_temp': lot.x_grosor, 
                'x_alto_temp': lot.x_alto,
                'x_ancho_temp': lot.x_ancho, 
                'x_color_temp': lot.x_color,
                'x_bloque_temp': lot.x_bloque, 
                'x_contenedor_temp': lot.x_contenedor
            })
            
            containers_map[cont_raw]['seq'] += 1
            move_lines_created += 1

        self.write({'packing_list_imported': True})
        return True

    # -------------------------------------------------------------------------
    # FUNCIONES DE SEGURIDAD PARA SPREADSHEET (EVITA ERROR STARTSWITH)
    # -------------------------------------------------------------------------

    def _format_cell_val(self, val):
        """ Garantiza que el valor sea SIEMPRE un string válido para o-spreadsheet. """
        if val is None or val is False:
            return ""
        if isinstance(val, (int, float)):
            return str(val)
        result = str(val).strip()
        return result if result else ""

    def _make_cell(self, val, style=None):
        content = self._format_cell_val(val)
        cell = {"content": content}
        if style is not None:
            cell["style"] = style
        return cell

    def _get_col_letter(self, n):
        string = ""
        while n >= 0:
            n, remainder = divmod(n, 26)
            string = chr(65 + remainder) + string
            n -= 1
        return string

    # -------------------------------------------------------------------------
    # GESTIÓN DE PACKING LIST INTERNO (ETAPA 1)
    # -------------------------------------------------------------------------
    
    def action_open_packing_list_spreadsheet(self):
        """ Crea o abre el Spreadsheet para el Packing List inicial. """
        self.ensure_one()
        
        if self.picking_type_code != 'incoming':
            raise UserError('Esta acción solo está disponible para Recepciones (Entradas).')
        
        if self.worksheet_imported:
            raise UserError('El Worksheet ya fue procesado. No es posible modificar el Packing List.')
            
        if not self.spreadsheet_id:
            products = self.move_ids.mapped('product_id')
            if not products:
                raise UserError('No hay productos cargados en esta operación.')

            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)
            headers = [
                'Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'Atado', 
                'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas'
            ]
            
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
                if any(s['name'] == sheet_name for s in sheets):
                    sheet_name = f"{sheet_name[:25]}_{product.id}"

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
                "styles": {
                    "1": {"bold": True, "fillColor": "#366092", "textColor": "#FFFFFF", "align": "center"}
                }
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
            if folder:
                vals['folder_id'] = folder.id

            self.spreadsheet_id = self.env['documents.document'].create(vals)

        return self._action_launch_spreadsheet(self.spreadsheet_id)

    # -------------------------------------------------------------------------
    # GESTIÓN DE WORKSHEET (ETAPA 2)
    # -------------------------------------------------------------------------

    def action_open_worksheet_spreadsheet(self):
        """ Crea un Spreadsheet independiente para el Worksheet con datos bloqueados. """
        self.ensure_one()
        if not self.packing_list_imported:
            raise UserError('Debe procesar primero el Packing List para generar el Worksheet.')

        if not self.ws_spreadsheet_id:
            products = self.move_line_ids.mapped('product_id')
            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)

            headers = [
                'Nº Lote', 'Grosor', 'Alto Teo.', 'Ancho Teo.', 'Color', 'Bloque', 
                'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov.', 
                'ALTO REAL (m)', 'ANCHO REAL (m)'
            ]
            
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
                "styles": {
                    "2": {"bold": True, "fillColor": "#1f5b13", "textColor": "#FFFFFF", "align": "center"}
                }
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
            if folder:
                vals['folder_id'] = folder.id

            self.ws_spreadsheet_id = self.env['documents.document'].create(vals)

        return self._action_launch_spreadsheet(self.ws_spreadsheet_id)

    # -------------------------------------------------------------------------
    # FUNCIONES DE APOYO Y EXPORTACIÓN EXCEL
    # -------------------------------------------------------------------------

    def _action_launch_spreadsheet(self, doc):
        """ Dispara la apertura del documento. """
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
        """ Descarga Excel para el Packing List. """
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
        """ Descarga Excel para el Worksheet. """
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

    # -------------------------------------------------------------------------
    # ACCIONES DE WIZARDS
    # -------------------------------------------------------------------------

    def action_import_packing_list(self):
        self.ensure_one()
        
        if self.worksheet_imported:
            raise UserError('El Worksheet ya fue procesado. No es posible reprocesar el Packing List.')
        
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
            'name': 'Procesar Worksheet (Medidas Reales)', 
            'type': 'ir.actions.act_window', 
            'res_model': 'worksheet.import.wizard', 
            'view_mode': 'form', 
            'target': 'new', 
            'context': {'default_picking_id': self.id}
        }```

## ./models/supplier_access.py
```py
# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta
from odoo import models, fields, api

class SupplierAccess(models.Model):
    _name = 'stock.picking.supplier.access'
    _description = 'Token de Acceso a Portal de Proveedor'

    picking_id = fields.Many2one('stock.picking', string="Recepción", required=True, ondelete='cascade')
    # Nuevo campo para ver los links desde la PO
    purchase_id = fields.Many2one('purchase.order', string="Orden de Compra", ondelete='cascade')
    
    access_token = fields.Char(string="Token", required=True, default=lambda self: str(uuid.uuid4()), readonly=True)
    expiration_date = fields.Datetime(string="Expira", required=True, default=lambda self: fields.Datetime.now() + timedelta(days=15))
    is_expired = fields.Boolean(compute="_compute_expired")
    portal_url = fields.Char(compute="_compute_url")

    @api.depends('expiration_date')
    def _compute_expired(self):
        for rec in self:
            rec.is_expired = rec.expiration_date < fields.Datetime.now()

    @api.depends('access_token')
    def _compute_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        for rec in self:
            rec.portal_url = f"{base_url}/supplier/pl/{rec.access_token}"```

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
/** @odoo-module **/

import { Component, useState, mount, xml } from "@odoo/owl";
import { templates } from "@web/core/assets";

class SupplierPortalApp extends Component {
    setup() {
        this.state = useState({
            data: window.portalData || {},
            products: window.portalData.products || [],
            rows: [], // Almacena todas las filas {id, product_id, ...}
            isSubmitting: false,
            nextId: 1
        });

        // Cargar datos guardados en LocalStorage por seguridad
        this.loadLocalState();
        
        // Si no hay filas, crear al menos una por producto
        if (this.state.rows.length === 0) {
            this.state.products.forEach(p => this.addRow(p.id));
        }
    }

    loadLocalState() {
        const key = `pl_portal_${this.state.data.token}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                this.state.rows = JSON.parse(saved);
                // Recuperar ID máximo
                const maxId = this.state.rows.reduce((max, r) => Math.max(max, r.id), 0);
                this.state.nextId = maxId + 1;
            } catch(e) {}
        }
    }

    saveState() {
        const key = `pl_portal_${this.state.data.token}`;
        localStorage.setItem(key, JSON.stringify(this.state.rows));
    }

    getProductRows(productId) {
        return this.state.rows.filter(r => r.product_id === productId);
    }

    addRow(productId) {
        // Clonar datos de la última fila de este producto para agilizar (ej. mismo contenedor/bloque)
        const existing = this.getProductRows(productId);
        let defaultData = { contenedor: '', bloque: '', grosor: 0, alto: 0, ancho: 0 };
        
        if (existing.length > 0) {
            const last = existing[existing.length - 1];
            defaultData = { 
                contenedor: last.contenedor, 
                bloque: last.bloque,
                grosor: last.grosor,
                alto: 0, ancho: 0 
            };
        }

        this.state.rows.push({
            id: this.state.nextId++,
            product_id: productId,
            ...defaultData,
            color: '',
            ref_prov: ''
        });
        this.saveState();
    }

    addMultipleRows(productId, count) {
        for(let i=0; i<count; i++) this.addRow(productId);
    }

    deleteRow(rowId) {
        this.state.rows = this.state.rows.filter(r => r.id !== rowId);
        this.saveState();
    }

    get totalPlates() {
        // Contar solo filas que tengan dimensiones válidas
        return this.state.rows.filter(r => r.alto > 0 && r.ancho > 0).length;
    }

    get totalArea() {
        return this.state.rows.reduce((acc, r) => acc + (r.alto * r.ancho), 0).toFixed(2);
    }

    async submitData() {
        if (!confirm("¿Está seguro de enviar el Packing List? Esto actualizará la recepción en el sistema.")) return;

        this.state.isSubmitting = true;
        const cleanData = this.state.rows
            .filter(r => r.alto > 0 && r.ancho > 0) // Solo enviar filas con datos
            .map(r => ({
                product_id: r.product_id,
                contenedor: r.contenedor,
                bloque: r.bloque,
                grosor: r.grosor,
                alto: r.alto,
                ancho: r.ancho,
                color: r.color,
                atado: '', // O agregar campo si es necesario
                tipo: 'placa'
            }));

        try {
            const response = await fetch('/supplier/pl/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    params: {
                        token: this.state.data.token,
                        rows: cleanData
                    },
                    id: Math.floor(Math.random() * 1000)
                })
            });

            const result = await response.json();
            if (result.result && result.result.success) {
                alert("✅ Packing List enviado correctamente. Gracias.");
                localStorage.removeItem(`pl_portal_${this.state.data.token}`); // Limpiar cache
                window.location.reload(); // O redirigir a página de éxito
            } else {
                const msg = result.error ? result.error.data.message : result.result.message;
                alert("❌ Error al procesar: " + msg);
            }
        } catch (error) {
            console.error(error);
            alert("Error de conexión.");
        } finally {
            this.state.isSubmitting = false;
        }
    }
}

SupplierPortalApp.template = "stock_lot_dimensions.SupplierPortalApp";

// Montaje de la app cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById("supplier-portal-app");
    if (root) {
        mount(SupplierPortalApp, root, { templates });
    }
});```

## ./static/src/scss/supplier_portal.scss
```scss
/* static/src/scss/supplier_portal.scss */

/* Variables de Branding */
$bg-dark: #121212;
$bg-card: #1e1e1e;
$primary-brown: #8B4513; /* SaddleBrown */
$primary-light: #A0522D; /* Sienna */
$text-white: #ffffff;
$text-gray: #b0b0b0;
$border-color: #333;
$accent-green: #2e7d32;

body {
    background-color: $bg-dark;
    color: $text-white;
    font-family: 'Inter', sans-serif;
}

.o_portal_header {
    background: rgba(30, 30, 30, 0.95);
    border-bottom: 2px solid $primary-brown;
    padding: 1rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(10px);

    .brand {
        font-size: 1.5rem;
        font-weight: 700;
        color: $text-white;
        span { color: $primary-brown; }
    }
    
    .po-info {
        text-align: right;
        .label { font-size: 0.75rem; color: $text-gray; text-transform: uppercase; }
        .value { font-weight: 600; color: #fff; }
    }
}

.o_portal_container {
    max-width: 1400px;
    margin: 2rem auto;
    padding: 0 1rem;
}

/* Tarjeta de Producto */
.product-section {
    background: $bg-card;
    border: 1px solid $border-color;
    border-radius: 8px;
    margin-bottom: 2rem;
    overflow: hidden;

    .product-header {
        background: #252525;
        padding: 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid $border-color;

        h3 { margin: 0; font-size: 1.1rem; color: #fff; }
        .meta { color: $text-gray; font-size: 0.9rem; }
    }

    .table-responsive {
        padding: 1rem;
    }
}

/* Tabla Estilizada */
.portal-table {
    width: 100%;
    border-collapse: collapse;
    color: $text-gray;

    th {
        text-align: left;
        padding: 0.75rem;
        color: $primary-light;
        font-size: 0.8rem;
        text-transform: uppercase;
        border-bottom: 1px solid $border-color;
    }

    td {
        padding: 0.5rem;
        border-bottom: 1px solid #2a2a2a;
        
        input {
            background: #121212;
            border: 1px solid #444;
            color: #fff;
            padding: 6px 10px;
            border-radius: 4px;
            width: 100%;
            transition: border-color 0.2s;

            &:focus {
                outline: none;
                border-color: $primary-brown;
            }
            
            &.short { width: 80px; }
            &.med { width: 120px; }
        }
    }

    .btn-action {
        background: none;
        border: none;
        color: #d32f2f;
        cursor: pointer;
        &:hover { color: #ff5252; }
    }
}

/* Botones */
.btn-primary-custom {
    background: $primary-brown;
    color: #fff;
    border: none;
    padding: 10px 25px;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    
    &:hover { background: $primary-light; }
    &:disabled { background: #444; cursor: not-allowed; }
}

.btn-add-row {
    background: #333;
    color: $text-white;
    border: 1px solid #444;
    padding: 6px 15px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    margin-top: 10px;
    display: inline-flex;
    align-items: center;
    gap: 5px;

    &:hover { background: #444; }
}

/* Footer flotante */
.submit-footer {
    position: fixed;
    bottom: 0; left: 0; width: 100%;
    background: #1a1a1a;
    padding: 1rem;
    border-top: 1px solid $primary-brown;
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    align-items: center;
    z-index: 99;

    .summary {
        margin-right: auto;
        color: $text-gray;
        span { color: $text-white; font-weight: bold; margin-left: 5px; }
    }
}```

## ./static/src/xml/supplier_portal.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<templates xml:space="preserve">
    <t t-name="stock_lot_dimensions.SupplierPortalApp" owl="1">
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
                <button name="action_generate_supplier_link"
                        string="Link Proveedor (PL)"
                        type="object"
                        class="btn-dark"
                        icon="fa-share-alt"
                        invisible="state not in ('purchase', 'done')"/>
            </xpath>

            <xpath expr="//notebook" position="inside">
                <page string="Links Portal" invisible="not supplier_access_ids">
                    <field name="supplier_access_ids">
                        <list editable="bottom" create="0">
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
</odoo>```

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
                
                <!-- BOTÓN "Link Proveedor" ELIMINADO DE AQUÍ (Movido a PO) -->

                <!-- ====================================================== -->
                <!-- ETAPA 1: PACKING LIST (CREACIÓN DE LOTES)              -->
                <!-- ====================================================== -->
                
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


                <!-- ====================================================== -->
                <!-- ETAPA 2: WORKSHEET (MEDIDAS REALES)                    -->
                <!-- ====================================================== -->
                
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

                <!-- EXPORTAR EXCEL -->
                <button name="action_download_worksheet"
                        string="Exportar WS"
                        type="object"
                        class="btn-outline-info"
                        icon="fa-file-excel-o"
                        invisible="state in ('done', 'cancel', 'draft') or picking_type_code != 'incoming' or not packing_list_imported"/>

            </xpath>

            <!-- Pestaña informativa en el Picking (opcional, pero útil para ver si la PO generó el link) -->
            <xpath expr="//notebook" position="inside">
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
        &lt;!DOCTYPE html&gt;
        <html lang="es">
            <head>
                <meta charset="utf-8"/>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <title>Portal de Proveedores</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&amp;display=swap" rel="stylesheet"/>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css"/>
                
                <t t-call-assets="web.assets_frontend" t-js="false"/>
                <t t-call-assets="web.assets_frontend" t-css="false"/>
            </head>
            <body class="supplier-portal-body">
                <main>
                    <t t-out="0"/>
                </main>
            </body>
        </html>
    </template>

    <template id="supplier_portal_view">
        <!-- Corrección de nombre aquí -->
        <t t-call="stock_lot_packing_import.portal_layout">
            <script>
                window.portalData = {
                    products: <t t-out="products_json"/>,
                    token: "<t t-out="token"/>",
                    poName: "<t t-out="picking.origin"/>",
                    pickingName: "<t t-out="picking.name"/>"
                };
            </script>
            <div id="supplier-portal-app"></div>
        </t>
    </template>

    <template id="portal_not_found">
        <t t-call="stock_lot_packing_import.portal_layout">
            <div class="error-container">
                <h1>404</h1>
                <p>Enlace no válido.</p>
            </div>
        </t>
    </template>

    <template id="portal_expired">
        <t t-call="stock_lot_packing_import.portal_layout">
             <div class="error-container">
                <h1><i class="fa fa-clock-o"/></h1>
                <p>Este enlace ha expirado.</p>
            </div>
        </t>
    </template>
</odoo>```

## ./wizard/__init__.py
```py
# -*- coding: utf-8 -*-
from . import packing_list_import_wizard
from . import worksheet_import_wizard
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

