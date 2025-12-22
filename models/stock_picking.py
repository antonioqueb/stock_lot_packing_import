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
    
    @api.depends('packing_list_file', 'spreadsheet_id')
    def _compute_has_packing_list(self):
        for rec in self:
            # Se considera que tiene PL si hay un archivo subido o si ya se generó el Spreadsheet
            rec.has_packing_list = bool(rec.packing_list_file or rec.spreadsheet_id)

    # -------------------------------------------------------------------------
    # FUNCIONES DE UTILIDAD (CRÍTICAS PARA EVITAR ERRORES JS)
    # -------------------------------------------------------------------------

    def _format_spreadsheet_val(self, val):
        """
        CORRECCIÓN DEFINITIVA: Odoo Spreadsheet JS requiere que 'content' sea SIEMPRE string.
        Esta función previene el error 'TypeError: cell.content.startsWith is not a function'.
        """
        if val is None or val is False:
            return ""
        # Convertimos a string y nos aseguramos de que no sea un objeto vacío
        return str(val)

    def _get_col_letter(self, n):
        """Convierte índice numérico a letra de columna (0=A, 1=B, ..., 12=M, 13=N)"""
        string = ""
        while n >= 0:
            n, remainder = divmod(n, 26)
            string = chr(65 + remainder) + string
            n -= 1
        return string

    # -------------------------------------------------------------------------
    # GESTIÓN DE PACKING LIST (ETAPA 1)
    # -------------------------------------------------------------------------
    
    def action_open_packing_list_spreadsheet(self):
        """
        Crea o abre el Spreadsheet para el Packing List inicial.
        Permite editar las 12 columnas base para la creación de lotes.
        """
        self.ensure_one()
        
        if self.picking_type_code != 'incoming':
            raise UserError('Esta acción solo está disponible para Recepciones (Entradas).')
            
        if not self.spreadsheet_id:
            products = self.move_ids.mapped('product_id')
            if not products:
                raise UserError('No hay productos cargados en esta operación.')

            # Carpeta raíz de documentos
            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)

            # Cabeceras estándar de PL (12 columnas)
            headers = [
                'Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'Atado', 
                'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas'
            ]
            
            sheets = []
            for index, product in enumerate(products):
                cells = {}
                # Fila 1: Info del producto (Asegurado como String)
                cells["A1"] = {"content": "PRODUCTO:"}
                product_info = self._format_spreadsheet_val(product.name) + " (" + self._format_spreadsheet_val(product.default_code) + ")"
                cells["B1"] = {"content": product_info}
                
                # Fila 3: Cabeceras
                for i, header in enumerate(headers):
                    col_letter = self._get_col_letter(i)
                    cells[f"{col_letter}3"] = {"content": self._format_spreadsheet_val(header), "style": 1}

                # Crear estructura de la pestaña
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
                'spreadsheet_data': json.dumps(spreadsheet_data),
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
        """
        Crea un Spreadsheet independiente para el Worksheet.
        Pre-carga los lotes importados del PL, los bloquea, y abre las columnas M y N.
        """
        self.ensure_one()
        if not self.packing_list_imported:
            raise UserError('Debe procesar primero el Packing List para generar el Worksheet.')

        if not self.ws_spreadsheet_id:
            products = self.move_line_ids.mapped('product_id')
            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)

            # 14 columnas: 12 informativas de PL (Bloqueadas) + 2 de ingreso real (Editables)
            headers = [
                'Nº Lote', 'Grosor', 'Alto Teo.', 'Ancho Teo.', 'Color', 'Bloque', 
                'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov.', 
                'ALTO REAL (m)', 'ANCHO REAL (m)'
            ]
            
            sheets = []
            for product in products:
                cells = {}
                # Encabezado de producto (Asegurado como String)
                cells["A1"] = {"content": "PRODUCTO:"}
                product_info = self._format_spreadsheet_val(product.name) + " (" + self._format_spreadsheet_val(product.default_code) + ")"
                cells["B1"] = {"content": product_info}
                
                # Cabeceras con estilo verde (WS)
                for i, header in enumerate(headers):
                    col_letter = self._get_col_letter(i)
                    cells[f"{col_letter}3"] = {"content": self._format_spreadsheet_val(header), "style": 2}

                # Carga de datos de lotes existentes (IMPORTANTE: str() en cada contenido)
                move_lines = self.move_line_ids.filtered(lambda ml: ml.product_id == product and ml.lot_id)
                row_idx = 4
                for ml in move_lines:
                    lot = ml.lot_id
                    cells[f"A{row_idx}"] = {"content": self._format_spreadsheet_val(lot.name)}
                    cells[f"B{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_grosor)}
                    cells[f"C{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_alto)}
                    cells[f"D{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_ancho)}
                    cells[f"E{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_color)}
                    cells[f"F{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_bloque)}
                    cells[f"G{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_atado)}
                    cells[f"H{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_tipo)}
                    cells[f"I{row_idx}"] = {"content": self._format_spreadsheet_val(", ".join(lot.x_grupo.mapped('name')))}
                    cells[f"J{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_pedimento)}
                    cells[f"K{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_contenedor)}
                    cells[f"L{row_idx}"] = {"content": self._format_spreadsheet_val(lot.x_referencia_proveedor)}
                    row_idx += 1

                sheet_name = (product.default_code or product.name)[:31]
                sheets.append({
                    "id": f"ws_sheet_{product.id}",
                    "name": sheet_name,
                    "cells": cells,
                    "colNumber": 14,
                    "rowNumber": max(row_idx + 20, 100),
                    "isProtected": True,
                    # Solo permitimos edición en las columnas M (índice 12) y N (índice 13)
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
                'spreadsheet_data': json.dumps(spreadsheet_data),
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
        """Dispara la apertura del documento en el cliente web"""
        doc_sudo = doc.sudo()
        # Buscamos el método de apertura compatible con Documents
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
        """Genera y descarga el archivo Excel para el Packing List (Etapa 1)"""
        self.ensure_one()
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Border, Side
        except ImportError:
            raise UserError('La librería openpyxl no está instalada.')
            
        wb = Workbook()
        wb.remove(wb.active)
        products = self.move_ids.mapped('product_id')
        header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        
        for product in products:
            ws = wb.create_sheet(title=(product.default_code or product.name)[:31])
            ws['A1'] = 'PRODUCTO:'; ws['B1'] = f'{product.name} ({product.default_code or ""})'
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num); cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            for row in range(4, 54):
                for col in range(1, 13): ws.cell(row=row, column=col).border = border
                
        output = io.BytesIO()
        wb.save(output)
        filename = f'Plantilla_PL_{self.name}.xlsx'
        self.write({'packing_list_file': base64.b64encode(output.getvalue()), 'packing_list_filename': filename})
        return {'type': 'ir.actions.act_url', 'url': f'/web/content?model=stock.picking&id={self.id}&field=packing_list_file&filename={filename}&download=true', 'target': 'self'}

    def action_download_worksheet(self):
        """Genera y descarga el archivo Excel para el Worksheet (Etapa 2) con datos de lotes"""
        self.ensure_one()
        if not self.packing_list_imported: raise UserError('Debe importar primero el Packing List.')
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Border, Side
        except ImportError: raise UserError('La librería openpyxl no está instalada.')
        
        wb = Workbook()
        wb.remove(wb.active)
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
                
        output = io.BytesIO()
        wb.save(output)
        filename = f'Worksheet_{self.name}.xlsx'
        self.write({'worksheet_file': base64.b64encode(output.getvalue()), 'worksheet_filename': filename})
        return {'type': 'ir.actions.act_url', 'url': f'/web/content?model=stock.picking&id={self.id}&field=worksheet_file&filename={filename}&download=true', 'target': 'self'}

    # -------------------------------------------------------------------------
    # ACCIONES DE WIZARDS
    # -------------------------------------------------------------------------

    def action_import_packing_list(self):
        """Dispara el Wizard de procesamiento de PL"""
        self.ensure_one()
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
        """Dispara el Wizard de procesamiento de WS"""
        self.ensure_one()
        return {
            'name': 'Procesar Worksheet (Medidas Reales)', 
            'type': 'ir.actions.act_window', 
            'res_model': 'worksheet.import.wizard', 
            'view_mode': 'form', 
            'target': 'new', 
            'context': {'default_picking_id': self.id}
        }