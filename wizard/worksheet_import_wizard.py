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
        
        if self.picking_id.picking_type_code != 'incoming':
            raise UserError('Solo se puede importar en recepciones')
        
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
        missing_lots = []
        
        # Agrupar lotes por contenedor para renumerar
        container_lots = {}
        
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            product_info = ws['B1'].value
            if not product_info:
                errors.append(f'Hoja {sheet_name}: No se encontró información del producto en B1')
                continue
            
            product_code = None
            if '(' in str(product_info) and ')' in str(product_info):
                code_part = str(product_info).split('(')[1].split(')')[0].strip()
                if code_part:
                    product_code = code_part
            
            if not product_code:
                product_name = str(product_info).split('(')[0].strip()
                product = self.env['product.product'].search([
                    ('name', 'ilike', product_name)
                ], limit=1)
            else:
                product = self.env['product.product'].search([
                    '|', ('default_code', '=', product_code), ('barcode', '=', product_code)
                ], limit=1)
            
            if not product:
                errors.append(f'Hoja {sheet_name}: No se encontró el producto')
                continue
            
            # Primera pasada: identificar lotes que llegaron y los que no
            lots_data = []
            
            for row in range(4, ws.max_row + 1):
                lot_name_val = ws.cell(row=row, column=1).value
                
                if lot_name_val is None:
                    continue
                
                if isinstance(lot_name_val, (int, float)):
                    lot_name = f'{int(lot_name_val):05d}'
                else:
                    lot_name = str(lot_name_val).strip()
                
                lot = self.env['stock.lot'].search([
                    ('name', '=', lot_name),
                    ('product_id', '=', product.id)
                ], limit=1)
                
                if not lot:
                    continue
                
                # Leer medidas reales (columnas L=12 y M=13)
                alto_real_val = ws.cell(row=row, column=12).value
                ancho_real_val = ws.cell(row=row, column=13).value
                
                # Si ambas medidas son 0 o están vacías, el lote NO llegó
                alto_real = float(alto_real_val) if alto_real_val not in (None, '', 0) else 0.0
                ancho_real = float(ancho_real_val) if ancho_real_val not in (None, '', 0) else 0.0
                
                if alto_real == 0.0 and ancho_real == 0.0:
                    # Lote NO llegó - marcarlo para eliminación
                    m2_faltante = lot.x_alto * lot.x_ancho if lot.x_alto and lot.x_ancho else 0
                    total_missing_pieces += 1
                    total_missing_m2 += m2_faltante
                    missing_lots.append({
                        'name': lot.name,
                        'product': product.name,
                        'm2': m2_faltante
                    })
                    
                    move_line = self.env['stock.move.line'].search([
                        ('picking_id', '=', self.picking_id.id),
                        ('lot_id', '=', lot.id),
                        ('product_id', '=', product.id)
                    ], limit=1)
                    
                    if move_line:
                        move_line.unlink()
                    
                    # Verificar si el lote está en otras recepciones
                    other_moves = self.env['stock.move.line'].search([
                        ('lot_id', '=', lot.id),
                        ('picking_id', '!=', self.picking_id.id)
                    ])
                    if not other_moves:
                        lot.unlink()
                else:
                    # Lote SÍ llegó - guardar para renumerar
                    lots_data.append({
                        'lot': lot,
                        'alto_real': alto_real,
                        'ancho_real': ancho_real,
                        'contenedor': lot.x_contenedor,
                        'original_name': lot.name
                    })
            
            # Agrupar por contenedor
            for lot_data in lots_data:
                contenedor = lot_data['contenedor']
                if contenedor not in container_lots:
                    container_lots[contenedor] = []
                container_lots[contenedor].append(lot_data)
        
        # Renumerar lotes por contenedor
        for contenedor, lots in container_lots.items():
            # Extraer el prefijo del primer lote
            if not lots:
                continue
            
            original_name = lots[0]['original_name']
            prefix = original_name.split('-')[0] if '-' in original_name else '1'
            
            # Ordenar por nombre original para mantener el orden
            lots.sort(key=lambda x: x['original_name'])
            
            # Renumerar secuencialmente
            for idx, lot_data in enumerate(lots, start=1):
                lot = lot_data['lot']
                alto_real = lot_data['alto_real']
                ancho_real = lot_data['ancho_real']
                
                # Nuevo nombre secuencial
                if idx < 10:
                    new_name = f'{prefix}-0{idx}'
                else:
                    new_name = f'{prefix}-{idx}'
                
                # Actualizar lote
                lot.write({
                    'name': new_name,
                    'x_alto': alto_real,
                    'x_ancho': ancho_real,
                })
                
                # Actualizar move line
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
            error_msg = 'No se encontraron cambios para procesar.'
            if errors:
                error_msg += '\n\nDetalles:\n' + '\n'.join(errors)
            raise UserError(error_msg)
        
        # Construir mensaje
        message = f'✓ Se actualizaron {lines_updated} lotes con medidas reales\n'
        
        if total_missing_pieces > 0:
            message += f'\n⚠️ MATERIAL FALTANTE:\n'
            message += f'• Piezas no arribadas: {total_missing_pieces}\n'
            message += f'• Total m² faltantes: {total_missing_m2:.2f} m²\n'
            message += f'\nLos lotes faltantes fueron eliminados y la secuencia fue ajustada.'
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': '¡Importación de Worksheet Completada!',
                'message': message,
                'type': 'warning' if total_missing_pieces > 0 else 'success',
                'sticky': True if total_missing_pieces > 0 else False,
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }