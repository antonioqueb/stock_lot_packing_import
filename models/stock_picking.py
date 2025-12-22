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
    spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet de Operación (PL/WS)', copy=False)
    has_packing_list = fields.Boolean(string='Tiene Packing List', compute='_compute_has_packing_list', store=True)
    packing_list_imported = fields.Boolean(string='Packing List Importado', default=False, copy=False)
    
    # --- Campos para el Worksheet (WS) ---
    worksheet_file = fields.Binary(string='Worksheet Exportado', attachment=True, copy=False)
    worksheet_filename = fields.Char(string='Nombre del Worksheet', copy=False)
    
    @api.depends('packing_list_file', 'spreadsheet_id')
    def _compute_has_packing_list(self):
        for rec in self:
            # Se considera que tiene PL si hay un archivo subido o si ya se generó el Spreadsheet
            rec.has_packing_list = bool(rec.packing_list_file or rec.spreadsheet_id)
    
    def action_open_packing_list_spreadsheet(self):
        """
        Crea o abre la hoja de cálculo nativa de Odoo.
        Diseñada con 14 columnas: 12 para el Packing List y 2 para el Worksheet.
        """
        self.ensure_one()
        
        if self.picking_type_code != 'incoming':
            raise UserError('Esta acción solo está disponible para Recepciones (Entradas).')
            
        if not self.spreadsheet_id:
            products = self.move_ids.mapped('product_id')
            if not products:
                raise UserError('No hay productos cargados en esta operación para generar la plantilla.')

            # Buscamos una carpeta por defecto para guardar el documento
            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)

            # Cabeceras Expandidas (14 columnas totales)
            # A-L: Packing List | M-N: Worksheet
            headers = [
                'Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'Atado', 
                'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas',
                'ALTO REAL (m)', 'ANCHO REAL (m)'
            ]
            
            sheets = []
            for index, product in enumerate(products):
                cells = {}
                # Celda A1 y B1: Identificación del Producto
                cells["A1"] = {"content": "PRODUCTO:"}
                cells["B1"] = {"content": f"{product.name} ({product.default_code or ''})"}
                
                # Fila 3: Cabeceras con Estilo
                for i, header in enumerate(headers):
                    # Lógica para letras de columna (A, B, C... M, N)
                    if i < 26:
                        col_letter = chr(65 + i)
                    else:
                        col_letter = f"A{chr(65 + i - 26)}"
                        
                    cell_id = f"{col_letter}3"
                    cells[cell_id] = {
                        "content": header,
                        "style": 1 # Estilo definido abajo (Azul con blanco)
                    }

                # Nombre de la pestaña (Máximo 31 caracteres según estándar Excel)
                sheet_name = (product.default_code or product.name)[:31]
                if any(s['name'] == sheet_name for s in sheets):
                    sheet_name = f"{sheet_name[:25]}_{product.id}"

                sheets.append({
                    "id": f"sheet_prod_{product.id}",
                    "name": sheet_name,
                    "cells": cells,
                    "colNumber": 14, # Aumentado a 14 columnas
                    "rowNumber": 250, # Espacio para 250 lotes por producto
                    "isProtected": True,
                    "protectedRanges": [{"range": "A4:N250", "isProtected": False}] # Solo editable el área de datos
                })

            # Estructura JSON del Spreadsheet de Odoo
            spreadsheet_data = {
                "version": 16,
                "sheets": sheets,
                "styles": {
                    "1": {"bold": True, "fillColor": "#366092", "textColor": "#FFFFFF", "align": "center"}
                }
            }

            vals = {
                'name': f'OPERACION: {self.name}.osheet',
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

        # Retornar la acción para abrir el Spreadsheet directamente
        doc = self.spreadsheet_id.sudo()
        # Intentamos los métodos estándar de Odoo para abrir hojas de cálculo
        for method_name in ["action_open_spreadsheet", "action_open", "access_content"]:
            open_meth = getattr(doc, method_name, None)
            if callable(open_meth):
                try:
                    action = open_meth()
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
        """Genera un Excel descargable sincronizado con las columnas del Spreadsheet"""
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
            sheet_name = product.default_code[:31] if product.default_code else f'Prod_{product.id}'[:31]
            ws = wb.create_sheet(title=sheet_name)
            
            ws['A1'] = 'PRODUCTO:'; ws['A1'].font = Font(bold=True)
            ws.merge_cells('B1:L1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            
            # Cabeceras idénticas al Spreadsheet
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header
                cell.fill = header_fill
                cell.font = header_font
                cell.border = border
            
            # Dibujar cuadrícula inicial para 50 filas
            for row in range(4, 54):
                for col in range(1, 13):
                    ws.cell(row=row, column=col).border = border
                    
        output = io.BytesIO()
        wb.save(output)
        excel_data = base64.b64encode(output.getvalue())
        filename = f'Plantilla_PL_{self.name}.xlsx'
        self.write({'packing_list_file': excel_data, 'packing_list_filename': filename})
        
        return {
            'type': 'ir.actions.act_url', 
            'url': f'/web/content?model=stock.picking&id={self.id}&field=packing_list_file&filename={filename}&download=true', 
            'target': 'self'
        }
    
    def action_download_worksheet(self):
        """
        Genera un Excel del Worksheet con los lotes YA IMPORTADOS.
        Esto sirve por si el usuario prefiere llenar las medidas reales en Excel en lugar del Spreadsheet.
        """
        self.ensure_one()
        if not self.packing_list_imported: 
            raise UserError('Debe procesar el Packing List primero para generar el Worksheet.')
            
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Border, Side
        except ImportError: 
            raise UserError('Instale openpyxl')
            
        wb = Workbook()
        wb.remove(wb.active)
        products = self.move_line_ids.mapped('product_id')
        
        header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        data_fill = PatternFill(start_color='E7E6E6', end_color='E7E6E6', fill_type='solid')
        editable_fill = PatternFill(start_color='FFFF00', end_color='FFFF00', fill_type='solid')
        border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        
        for product in products:
            sheet_name = product.default_code[:31] if product.default_code else f'Prod_{product.id}'[:31]
            ws = wb.create_sheet(title=sheet_name)
            
            ws['A1'] = 'PRODUCTO:'; ws.merge_cells('B1:M1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            
            # Cabeceras completas incluyendo las de edición
            headers = [
                'Nº Lote', 'Grosor', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 
                'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov', 
                'Cantidad', 'Alto Real (m)', 'Ancho Real (m)'
            ]
            
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header
                cell.fill = header_fill
                cell.font = header_font
                cell.border = border
            
            # Obtener líneas de este producto con lotes creados
            move_lines = self.move_line_ids.filtered(lambda ml: ml.product_id == product and ml.lot_id)
            current_row = 4
            for ml in move_lines:
                lot = ml.lot_id
                # Llenar datos base (No editables visualmente con gris)
                ws.cell(row=current_row, column=1, value=lot.name).fill = data_fill
                ws.cell(row=current_row, column=2, value=lot.x_grosor).fill = data_fill
                ws.cell(row=current_row, column=3, value=lot.x_alto).fill = data_fill
                ws.cell(row=current_row, column=4, value=lot.x_ancho).fill = data_fill
                ws.cell(row=current_row, column=5, value=lot.x_color).fill = data_fill
                ws.cell(row=current_row, column=6, value=lot.x_bloque).fill = data_fill
                ws.cell(row=current_row, column=7, value=lot.x_atado).fill = data_fill
                ws.cell(row=current_row, column=8, value=dict(lot._fields['x_tipo'].selection).get(lot.x_tipo, '')).fill = data_fill
                ws.cell(row=current_row, column=9, value=", ".join(lot.x_grupo.mapped('name'))).fill = data_fill
                ws.cell(row=current_row, column=10, value=lot.x_pedimento).fill = data_fill
                ws.cell(row=current_row, column=11, value=lot.x_contenedor).fill = data_fill
                ws.cell(row=current_row, column=12, value=lot.x_referencia_proveedor).fill = data_fill
                ws.cell(row=current_row, column=13, value=ml.qty_done).fill = data_fill
                
                for col in range(1, 14): ws.cell(row=current_row, column=col).border = border
                
                # Columnas editables (Amarillo) para el Worksheet
                ws.cell(row=current_row, column=14).fill = editable_fill # Alto Real
                ws.cell(row=current_row, column=14).border = border
                ws.cell(row=current_row, column=15).fill = editable_fill # Ancho Real
                ws.cell(row=current_row, column=15).border = border
                
                current_row += 1
                
        output = io.BytesIO()
        wb.save(output)
        excel_data = base64.b64encode(output.getvalue())
        filename = f'Worksheet_{self.name}.xlsx'
        self.write({'worksheet_file': excel_data, 'worksheet_filename': filename})
        
        return {
            'type': 'ir.actions.act_url', 
            'url': f'/web/content?model=stock.picking&id={self.id}&field=worksheet_file&filename={filename}&download=true', 
            'target': 'self'
        }
    
    def action_import_packing_list(self):
        """Abre el wizard para procesar el Packing List (Crea los lotes)"""
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
        """Abre el wizard para procesar el Worksheet (Actualiza medidas reales de lotes existentes)"""
        self.ensure_one()
        return {
            'name': 'Importar Worksheet (Medidas Reales)', 
            'type': 'ir.actions.act_window', 
            'res_model': 'worksheet.import.wizard', 
            'view_mode': 'form', 
            'target': 'new', 
            'context': {'default_picking_id': self.id}
        }