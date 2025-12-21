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
    
    # --- Campos de Packing List ---
    packing_list_file = fields.Binary(string='Packing List (Archivo)', attachment=True, copy=False)
    packing_list_filename = fields.Char(string='Nombre del archivo', copy=False)
    
    # Relación con Documents (App nativa que ya tienes instalada)
    spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet de Packing List', copy=False)
    
    has_packing_list = fields.Boolean(string='Tiene Packing List', compute='_compute_has_packing_list', store=True)
    packing_list_imported = fields.Boolean(string='Packing List Importado', default=False, copy=False)
    
    # --- Campos para el Worksheet ---
    worksheet_file = fields.Binary(string='Worksheet', attachment=True, copy=False)
    worksheet_filename = fields.Char(string='Nombre del Worksheet', copy=False)
    
    @api.depends('packing_list_file', 'spreadsheet_id')
    def _compute_has_packing_list(self):
        for rec in self:
            rec.has_packing_list = bool(rec.packing_list_file or rec.spreadsheet_id)
    
    def action_open_packing_list_spreadsheet(self):
        """
        Crea o abre una hoja de cálculo nativa de Odoo usando el modelo documents.document
        """
        self.ensure_one()
        
        if self.picking_type_code != 'incoming':
            raise UserError('Esta acción solo está disponible para Recepciones.')
            
        if not self.spreadsheet_id:
            products = self.move_ids.mapped('product_id')
            if not products:
                raise UserError('No hay productos en esta operación.')

            # Buscamos un documento que actúe como carpeta (Workspace)
            # En Odoo 19, las carpetas son documents.document con type='folder'
            folder = self.env['documents.document'].search([
                ('type', '=', 'folder')
            ], limit=1)

            # Estructura de cabeceras
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Bloque', 'Atado', 'Tipo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            
            cells = {}
            # Fila 1: Info del producto
            product_names = ", ".join(products.mapped(lambda p: f"{p.name} ({p.default_code or ''})"))
            cells["0"] = {
                "0": {"content": "PRODUCTO(S):"},
                "1": {"content": product_names}
            }
            
            # Fila 3: Cabeceras (Índice 2)
            for i, header in enumerate(headers):
                cells["2"] = cells.get("2", {})
                cells["2"][str(i)] = {
                    "content": header,
                    "style": 1 
                }

            spreadsheet_data = {
                "version": 16,
                "sheets": [
                    {
                        "id": "sheet1",
                        "name": "Packing List",
                        "cells": cells,
                        "colNumber": 10,
                        "rowNumber": 100,
                        "areLinesVisible": True,
                        "isProtected": True,
                        "protectedRanges": [
                            {"range": "A4:J100", "isProtected": False} 
                        ]
                    }
                ],
                "styles": {
                    "1": {"bold": True, "fillColor": "#366092", "textColor": "#FFFFFF", "align": "center"}
                }
            }

            # VALS LIMPIOS: Solo usamos campos que existen 100% en documents.document
            # Evitamos parent_id o document_type para prevenir KeyErrors
            vals = {
                'name': f'PL: {self.name}.osheet',
                'type': 'spreadsheet',
                'handler': 'spreadsheet',
                'mimetype': 'application/o-spreadsheet',
                'spreadsheet_data': json.dumps(spreadsheet_data),
                'res_model': 'stock.picking',
                'res_id': self.id,
            }
            
            # folder_id es el campo estándar para Workspaces en Odoo 19 Enterprise
            if folder:
                vals['folder_id'] = folder.id

            new_spreadsheet = self.env['documents.document'].create(vals)
            self.spreadsheet_id = new_spreadsheet

        # Abrir el documento directamente
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'documents.document',
            'res_id': self.spreadsheet_id.id,
            'view_mode': 'form',
            'target': 'current',
        }

    # --- Los métodos de descarga (Worksheet) se mantienen intactos ---

    def action_download_packing_template(self):
        self.ensure_one()
        if self.picking_type_code != 'incoming':
            raise UserError('Solo disponible para Recepciones.')
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        except ImportError:
            raise UserError('Instale openpyxl')
        
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
            ws.merge_cells('B1:J1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Bloque', 'Atado', 'Tipo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            for row in range(4, 54):
                for col in range(1, 11):
                    ws.cell(row=row, column=col).border = border

        output = io.BytesIO()
        wb.save(output)
        excel_data = base64.b64encode(output.getvalue())
        filename = f'Packing_List_{self.name}.xlsx'
        self.write({'packing_list_file': excel_data, 'packing_list_filename': filename})
        return {
            'type': 'ir.actions.act_url',
            'url': f'/web/content?model=stock.picking&id={self.id}&field=packing_list_file&filename={filename}&download=true',
            'target': 'self',
        }
    
    def action_download_worksheet(self):
        self.ensure_one()
        if self.picking_type_code != 'incoming':
            raise UserError('Solo disponible para Recepciones.')
        if not self.packing_list_imported:
            raise UserError('Debe importar primero un Packing List')
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
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
            ws['A1'] = 'PRODUCTO:'; ws.merge_cells('B1:J1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            headers = ['Nº Lote', 'Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Bloque', 'Atado', 'Tipo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Cantidad', 'Alto Real (m)', 'Ancho Real (m)']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            move_lines = self.move_line_ids.filtered(lambda ml: ml.product_id == product and ml.lot_id)
            current_row = 4
            for ml in move_lines:
                lot = ml.lot_id
                ws.cell(row=current_row, column=1, value=lot.name).fill = data_fill
                ws.cell(row=current_row, column=2, value=lot.x_grosor).fill = data_fill
                ws.cell(row=current_row, column=3, value=lot.x_alto).fill = data_fill
                ws.cell(row=current_row, column=4, value=lot.x_ancho).fill = data_fill
                ws.cell(row=current_row, column=5, value=lot.x_bloque).fill = data_fill
                ws.cell(row=current_row, column=6, value=lot.x_atado).fill = data_fill
                ws.cell(row=current_row, column=7, value=dict(lot._fields['x_tipo'].selection).get(lot.x_tipo, '')).fill = data_fill
                ws.cell(row=current_row, column=8, value=lot.x_pedimento).fill = data_fill
                ws.cell(row=current_row, column=9, value=lot.x_contenedor).fill = data_fill
                ws.cell(row=current_row, column=10, value=lot.x_referencia_proveedor).fill = data_fill
                ws.cell(row=current_row, column=11, value=ml.qty_done).fill = data_fill
                for col in range(1, 12):
                    ws.cell(row=current_row, column=col).border = border
                for col in range(12, 14):
                    cell = ws.cell(row=current_row, column=col)
                    cell.fill = editable_fill; cell.border = border
                current_row += 1
        
        output = io.BytesIO()
        wb.save(output)
        excel_data = base64.b64encode(output.getvalue())
        filename = f'Worksheet_{self.name}.xlsx'
        self.write({'worksheet_file': excel_data, 'worksheet_filename': filename})
        return {
            'type': 'ir.actions.act_url',
            'url': f'/web/content?model=stock.picking&id={self.id}&field=worksheet_file&filename={filename}&download=true',
            'target': 'self',
        }
    
    def action_import_packing_list(self):
        self.ensure_one()
        return {
            'name': 'Procesar / Importar Packing List',
            'type': 'ir.actions.act_window',
            'res_model': 'packing.list.import.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_picking_id': self.id}
        }
    
    def action_import_worksheet(self):
        self.ensure_one()
        return {
            'name': 'Importar Worksheet',
            'type': 'ir.actions.act_window',
            'res_model': 'worksheet.import.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_picking_id': self.id}
        }