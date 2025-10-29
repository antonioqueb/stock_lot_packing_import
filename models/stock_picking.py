# -*- coding: utf-8 -*-
from odoo import models, fields, api
from odoo.exceptions import UserError
import io
import base64

class StockPicking(models.Model):
    _inherit = 'stock.picking'
    
    packing_list_file = fields.Binary(string='Packing List', attachment=True)
    packing_list_filename = fields.Char(string='Nombre del archivo')
    has_packing_list = fields.Boolean(string='Tiene Packing List', compute='_compute_has_packing_list', store=True)
    packing_list_imported = fields.Boolean(string='Packing List Importado', default=False)
    
    # Nuevos campos para el Worksheet
    worksheet_file = fields.Binary(string='Worksheet', attachment=True)
    worksheet_filename = fields.Char(string='Nombre del Worksheet')
    
    @api.depends('packing_list_file')
    def _compute_has_packing_list(self):
        for rec in self:
            rec.has_packing_list = bool(rec.packing_list_file)
    
    def action_download_packing_template(self):
        self.ensure_one()
        
        if self.picking_type_code != 'incoming':
            raise UserError('Solo disponible para recepciones')
        
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        wb = Workbook()
        wb.remove(wb.active)
        
        products = self.move_ids.mapped('product_id')
        if not products:
            raise UserError('No hay productos en esta recepción')
        
        header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        for product in products:
            sheet_name = product.default_code[:31] if product.default_code else f'Prod_{product.id}'[:31]
            ws = wb.create_sheet(title=sheet_name)
            
            ws['A1'] = 'PRODUCTO:'
            ws['A1'].font = Font(bold=True)
            ws.merge_cells('B1:G1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            ws['B1'].font = Font(bold=True, color='0000FF')
            ws['B1'].alignment = Alignment(horizontal='left', vertical='center')
            
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Bloque', 'Atado', 'Formato', 'Notas']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
            
            ws.column_dimensions['A'].width = 15  # Grosor
            ws.column_dimensions['B'].width = 12  # Alto
            ws.column_dimensions['C'].width = 12  # Ancho
            ws.column_dimensions['D'].width = 15  # Bloque
            ws.column_dimensions['E'].width = 15  # Atado
            ws.column_dimensions['F'].width = 15  # Formato
            ws.column_dimensions['G'].width = 30  # Notas
            
            for row in range(4, 54):
                for col in range(1, 8):
                    ws.cell(row=row, column=col).border = border
                    ws.cell(row=row, column=col).alignment = Alignment(horizontal='center', vertical='center')
        
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        excel_data = base64.b64encode(output.read())
        
        filename = f'Packing_List_{self.name}.xlsx'
        self.write({
            'packing_list_file': excel_data,
            'packing_list_filename': filename
        })
        
        return {
            'type': 'ir.actions.act_url',
            'url': f'/web/content?model=stock.picking&id={self.id}&field=packing_list_file&filename={filename}&download=true',
            'target': 'self',
        }
    
    def action_download_worksheet(self):
        """Generar Worksheet con los lotes ya creados y columnas para medidas reales"""
        self.ensure_one()
        
        if self.picking_type_code != 'incoming':
            raise UserError('Solo disponible para recepciones')
        
        if not self.packing_list_imported:
            raise UserError('Debe importar primero un Packing List')
        
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        wb = Workbook()
        wb.remove(wb.active)
        
        # Obtener productos que tienen move lines con lotes
        products = self.move_line_ids.mapped('product_id')
        
        if not products:
            raise UserError('No hay lotes creados en esta recepción')
        
        header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        data_fill = PatternFill(start_color='E7E6E6', end_color='E7E6E6', fill_type='solid')
        editable_fill = PatternFill(start_color='FFFF00', end_color='FFFF00', fill_type='solid')
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        for product in products:
            sheet_name = product.default_code[:31] if product.default_code else f'Prod_{product.id}'[:31]
            ws = wb.create_sheet(title=sheet_name)
            
            # Encabezado del producto
            ws['A1'] = 'PRODUCTO:'
            ws['A1'].font = Font(bold=True)
            ws.merge_cells('B1:G1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            ws['B1'].font = Font(bold=True, color='0000FF')
            ws['B1'].alignment = Alignment(horizontal='left', vertical='center')
            
            # Headers
            headers = ['Nº Lote', 'Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Bloque', 'Atado', 'Formato', 'Cantidad', 'Alto Real (m)', 'Ancho Real (m)']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
            
            # Configurar anchos de columna
            ws.column_dimensions['A'].width = 12  # Nº Lote
            ws.column_dimensions['B'].width = 12  # Grosor
            ws.column_dimensions['C'].width = 12  # Alto
            ws.column_dimensions['D'].width = 12  # Ancho
            ws.column_dimensions['E'].width = 15  # Bloque
            ws.column_dimensions['F'].width = 15  # Atado
            ws.column_dimensions['G'].width = 15  # Formato
            ws.column_dimensions['H'].width = 12  # Cantidad
            ws.column_dimensions['I'].width = 15  # Alto Real
            ws.column_dimensions['J'].width = 15  # Ancho Real
            
            # Obtener move lines de este producto
            move_lines = self.move_line_ids.filtered(lambda ml: ml.product_id == product and ml.lot_id)
            
            current_row = 4
            for ml in move_lines:
                lot = ml.lot_id
                
                # Columna A: Número de Lote (solo lectura)
                cell = ws.cell(row=current_row, column=1)
                cell.value = lot.name
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna B: Grosor (solo lectura)
                cell = ws.cell(row=current_row, column=2)
                cell.value = lot.x_grosor
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna C: Alto (solo lectura)
                cell = ws.cell(row=current_row, column=3)
                cell.value = lot.x_alto
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna D: Ancho (solo lectura)
                cell = ws.cell(row=current_row, column=4)
                cell.value = lot.x_ancho
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna E: Bloque (solo lectura)
                cell = ws.cell(row=current_row, column=5)
                cell.value = lot.x_bloque
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna F: Atado (solo lectura)
                cell = ws.cell(row=current_row, column=6)
                cell.value = lot.x_atado
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna G: Formato (solo lectura)
                cell = ws.cell(row=current_row, column=7)
                cell.value = lot.x_formato
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna H: Cantidad (solo lectura)
                cell = ws.cell(row=current_row, column=8)
                cell.value = ml.qty_done
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna I: Alto Real (editable - VACÍA)
                cell = ws.cell(row=current_row, column=9)
                cell.value = None
                cell.fill = editable_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna J: Ancho Real (editable - VACÍA)
                cell = ws.cell(row=current_row, column=10)
                cell.value = None
                cell.fill = editable_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                current_row += 1
        
        # IMPORTANTE: Guardar el archivo en el campo worksheet_file
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        excel_data = base64.b64encode(output.read())
        
        filename = f'Worksheet_{self.name}.xlsx'
        
        # Guardar el archivo en el registro
        self.write({
            'worksheet_file': excel_data,
            'worksheet_filename': filename
        })
        
        # Retornar la descarga usando el campo correcto
        return {
            'type': 'ir.actions.act_url',
            'url': f'/web/content?model=stock.picking&id={self.id}&field=worksheet_file&filename={filename}&download=true',
            'target': 'self',
        }
    
    def action_import_packing_list(self):
        self.ensure_one()
        
        return {
            'name': 'Importar Packing List',
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