# -*- coding: utf-8 -*-
from odoo import models, fields
from odoo.exceptions import UserError
import base64
import io

class WorksheetImportWizard(models.TransientModel):
    _name = 'worksheet.import.wizard'
    _description = 'Importar Worksheet Excel'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=True, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def action_import_worksheet(self):
        self.ensure_one()
        
        if not self.excel_file:
            raise UserError('Debe seleccionar un archivo Excel')
        
        # VALIDACIÓN 1: Tipo de operación
        if self.picking_id.picking_type_code != 'incoming':
            raise UserError('Solo se puede importar en recepciones.')

        # VALIDACIÓN 2 (CRÍTICA): Estado de la operación
        if self.picking_id.state == 'done':
            raise UserError('La recepción ya está validada (Hecho). No se puede procesar el Worksheet porque modificaría lotes que ya están en el inventario histórico.')
        
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        try:
            excel_data = base64.b64decode(self.excel_file)
            wb = load_workbook(io.BytesIO(excel_data))
        except Exception as e:
            raise UserError(f'Error al leer el archivo Excel: {str(e)}')
        
        lines_updated = 0
        errors = []
        total_missing_pieces = 0
        total_missing_m2 = 0
        
        container_lots = {}
        
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            product_info = ws['B1'].value
            if not product_info:
                errors.append(f'Hoja {sheet_name}: Sin info de producto en B1')
                continue
            
            product_code = None
            if '(' in str(product_info) and ')' in str(product_info):
                code_part = str(product_info).split('(')[1].split(')')[0].strip()
                if code_part:
                    product_code = code_part
            
            product = False
            if product_code:
                product = self.env['product.product'].search([
                    '|', ('default_code', '=', product_code), ('barcode', '=', product_code)
                ], limit=1)
            
            if not product:
                product_name = str(product_info).split('(')[0].strip()
                product = self.env['product.product'].search([('name', '=', product_name)], limit=1)
                if not product:
                     product = self.env['product.product'].search([('name', 'ilike', product_name)], limit=1)
            
            if not product:
                errors.append(f'Hoja {sheet_name}: No se encontró el producto')
                continue
            
            lots_data = []
            
            for row in range(4, ws.max_row + 1):
                lot_name_val = ws.cell(row=row, column=1).value
                if lot_name_val is None:
                    continue
                
                lot_name = f'{int(lot_name_val):05d}' if isinstance(lot_name_val, (int, float)) else str(lot_name_val).strip()
                
                lot = self.env['stock.lot'].search([
                    ('name', '=', lot_name),
                    ('product_id', '=', product.id)
                ], limit=1)
                
                if not lot:
                    continue
                
                alto_real_val = ws.cell(row=row, column=12).value
                ancho_real_val = ws.cell(row=row, column=13).value
                
                alto_real = float(alto_real_val) if alto_real_val not in (None, '', 0) else 0.0
                ancho_real = float(ancho_real_val) if ancho_real_val not in (None, '', 0) else 0.0
                
                if alto_real == 0.0 and ancho_real == 0.0:
                    # Lote NO llegó, marcarlo para eliminación
                    m2_faltante = lot.x_alto * lot.x_ancho if lot.x_alto and lot.x_ancho else 0
                    total_missing_pieces += 1
                    total_missing_m2 += m2_faltante
                    
                    move_line = self.env['stock.move.line'].search([
                        ('picking_id', '=', self.picking_id.id),
                        ('lot_id', '=', lot.id),
                        ('product_id', '=', product.id)
                    ], limit=1)
                    
                    if move_line:
                        move_line.unlink()
                    
                    other_moves = self.env['stock.move.line'].search([
                        ('lot_id', '=', lot.id),
                        ('picking_id', '!=', self.picking_id.id)
                    ])
                    if not other_moves:
                        lot.unlink()
                else:
                    lots_data.append({
                        'lot': lot,
                        'alto_real': alto_real,
                        'ancho_real': ancho_real,
                        'contenedor': lot.x_contenedor,
                        'original_name': lot.name
                    })
            
            for lot_data in lots_data:
                contenedor = lot_data['contenedor']
                if contenedor not in container_lots:
                    container_lots[contenedor] = []
                container_lots[contenedor].append(lot_data)
        
        # Renumeración
        for contenedor, lots in container_lots.items():
            if not lots:
                continue
            
            original_name = lots[0]['original_name']
            prefix = original_name.split('-')[0] if '-' in original_name else '1'
            lots.sort(key=lambda x: x['original_name'])
            
            for idx, lot_data in enumerate(lots, start=1):
                lot = lot_data['lot']
                alto_real = lot_data['alto_real']
                ancho_real = lot_data['ancho_real']
                
                new_name = f'{prefix}-{idx:02d}' if idx < 100 else f'{prefix}-{idx}'
                
                lot.write({
                    'name': new_name,
                    'x_alto': alto_real,
                    'x_ancho': ancho_real,
                })
                
                move_line = self.env['stock.move.line'].search([
                    ('picking_id', '=', self.picking_id.id),
                    ('lot_id', '=', lot.id)
                ], limit=1)
                
                if move_line:
                    qty_done = alto_real * ancho_real if (alto_real and ancho_real) else move_line.qty_done
                    move_line.write({
                        'qty_done': qty_done,
                        'x_alto_temp': alto_real,
                        'x_ancho_temp': ancho_real,
                    })
                
                lines_updated += 1
        
        if lines_updated == 0 and total_missing_pieces == 0:
            error_msg = 'No se encontraron cambios.'
            if errors:
                error_msg += '\n\nDetalles:\n' + '\n'.join(errors)
            raise UserError(error_msg)
        
        message = f'✓ Se actualizaron {lines_updated} lotes\n'
        if total_missing_pieces > 0:
            message += f'\n⚠️ MATERIAL FALTANTE:\n• Piezas no arribadas: {total_missing_pieces}\n• Total m²: {total_missing_m2:.2f} m²\n(Lotes eliminados)'
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Proceso Completado',
                'message': message,
                'type': 'warning' if total_missing_pieces > 0 else 'success',
                'sticky': True if total_missing_pieces > 0 else False,
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }