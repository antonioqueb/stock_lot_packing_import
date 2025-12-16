# -*- coding: utf-8 -*-
from odoo import models, fields, api
from odoo.exceptions import UserError
import io
import base64
import logging

_logger = logging.getLogger(__name__)

class StockPicking(models.Model):
    _inherit = 'stock.picking'
    
    # copy=False evita que los archivos se copien a backorders (pedidos pendientes)
    packing_list_file = fields.Binary(string='Packing List', attachment=True, copy=False)
    packing_list_filename = fields.Char(string='Nombre del archivo', copy=False)
    has_packing_list = fields.Boolean(string='Tiene Packing List', compute='_compute_has_packing_list', store=True)
    packing_list_imported = fields.Boolean(string='Packing List Importado', default=False, copy=False)
    
    # Campos para el Worksheet
    worksheet_file = fields.Binary(string='Worksheet', attachment=True, copy=False)
    worksheet_filename = fields.Char(string='Nombre del Worksheet', copy=False)
    
    @api.depends('packing_list_file')
    def _compute_has_packing_list(self):
        for rec in self:
            rec.has_packing_list = bool(rec.packing_list_file)
    
    def action_download_packing_template(self):
        self.ensure_one()
        
        _logger.info('='*80)
        _logger.info(f'DEBUG PACKING TEMPLATE - Picking ID: {self.id}')
        
        # VALIDACIÓN DE SEGURIDAD
        if self.picking_type_code != 'incoming':
            raise UserError('Esta acción solo está disponible para Recepciones.')
        
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        wb = Workbook()
        wb.remove(wb.active)
        
        products = self.move_ids.mapped('product_id')
        if not products:
            raise UserError('No hay productos en esta operación')
        
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
            ws.merge_cells('B1:J1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            ws['B1'].font = Font(bold=True, color='0000FF')
            ws['B1'].alignment = Alignment(horizontal='left', vertical='center')
            
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Bloque', 'Atado', 'Tipo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
            
            ws.column_dimensions['A'].width = 15
            ws.column_dimensions['B'].width = 12
            ws.column_dimensions['C'].width = 12
            ws.column_dimensions['D'].width = 15
            ws.column_dimensions['E'].width = 15
            ws.column_dimensions['F'].width = 15
            ws.column_dimensions['G'].width = 18
            ws.column_dimensions['H'].width = 18
            ws.column_dimensions['I'].width = 20
            ws.column_dimensions['J'].width = 30
            
            for row in range(4, 54):
                for col in range(1, 11):
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
        self.ensure_one()
        
        _logger.info('='*80)
        _logger.info(f'DEBUG WORKSHEET - Picking ID: {self.id}')
        
        # VALIDACIÓN DE SEGURIDAD
        if self.picking_type_code != 'incoming':
            raise UserError('Esta acción solo está disponible para Recepciones.')
        
        if not self.packing_list_imported:
            raise UserError('Debe importar primero un Packing List')
        
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        wb = Workbook()
        wb.remove(wb.active)
        
        products = self.move_line_ids.mapped('product_id')
        
        if not products:
            raise UserError('No hay lotes creados en esta operación')
        
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
            
            ws['A1'] = 'PRODUCTO:'
            ws['A1'].font = Font(bold=True)
            ws.merge_cells('B1:J1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            ws['B1'].font = Font(bold=True, color='0000FF')
            ws['B1'].alignment = Alignment(horizontal='left', vertical='center')
            
            headers = ['Nº Lote', 'Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Bloque', 'Atado', 'Tipo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Cantidad', 'Alto Real (m)', 'Ancho Real (m)']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
            
            ws.column_dimensions['A'].width = 12
            ws.column_dimensions['B'].width = 12
            ws.column_dimensions['C'].width = 12
            ws.column_dimensions['D'].width = 12
            ws.column_dimensions['E'].width = 15
            ws.column_dimensions['F'].width = 15
            ws.column_dimensions['G'].width = 15
            ws.column_dimensions['H'].width = 18
            ws.column_dimensions['I'].width = 18
            ws.column_dimensions['J'].width = 20
            ws.column_dimensions['K'].width = 12
            ws.column_dimensions['L'].width = 15
            ws.column_dimensions['M'].width = 15
            
            move_lines = self.move_line_ids.filtered(lambda ml: ml.product_id == product and ml.lot_id)
            
            current_row = 4
            for ml in move_lines:
                lot = ml.lot_id
                
                # Celdas solo lectura
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
                
                # Bordes para datos
                for col in range(1, 12):
                    ws.cell(row=current_row, column=col).border = border
                    ws.cell(row=current_row, column=col).alignment = Alignment(horizontal='center', vertical='center')

                # Celdas editables
                for col in range(12, 14):
                    cell = ws.cell(row=current_row, column=col)
                    cell.value = None
                    cell.fill = editable_fill
                    cell.alignment = Alignment(horizontal='center', vertical='center')
                    cell.border = border
                
                current_row += 1
        
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        excel_data = base64.b64encode(output.read())
        
        filename = f'Worksheet_{self.name}.xlsx'
        
        self.write({
            'worksheet_file': excel_data,
            'worksheet_filename': filename
        })
        
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