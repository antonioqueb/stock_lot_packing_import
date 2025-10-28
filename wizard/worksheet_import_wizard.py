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
        
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            # Extraer información del producto desde B1
            product_info = ws['B1'].value
            if not product_info:
                errors.append(f'Hoja {sheet_name}: No se encontró información del producto en B1')
                continue
            
            # Extraer código del producto
            product_code = None
            if '(' in str(product_info) and ')' in str(product_info):
                code_part = str(product_info).split('(')[1].split(')')[0].strip()
                if code_part:
                    product_code = code_part
            
            # Buscar producto
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
            
            # Procesar filas (empezando desde fila 4)
            for row in range(4, ws.max_row + 1):
                # Leer número de lote de la columna A
                lot_name_val = ws.cell(row=row, column=1).value
                
                if lot_name_val is None:
                    continue
                
                # Formatear el nombre del lote
                if isinstance(lot_name_val, (int, float)):
                    lot_name = f'{int(lot_name_val):05d}'
                else:
                    lot_name = str(lot_name_val).strip()
                
                # Buscar el lote existente
                lot = self.env['stock.lot'].search([
                    ('name', '=', lot_name),
                    ('product_id', '=', product.id)
                ], limit=1)
                
                if not lot:
                    continue
                
                # Leer las nuevas medidas (columnas H=Alto Real, I=Ancho Real)
                alto_real_val = ws.cell(row=row, column=8).value  # Columna H
                ancho_real_val = ws.cell(row=row, column=9).value  # Columna I
                
                # Si hay medidas nuevas, actualizar
                if alto_real_val is not None or ancho_real_val is not None:
                    try:
                        alto_real = float(alto_real_val) if alto_real_val is not None else lot.x_alto
                        ancho_real = float(ancho_real_val) if ancho_real_val is not None else lot.x_ancho
                        
                        # Actualizar el lote con las medidas reales
                        lot.write({
                            'x_alto': alto_real,
                            'x_ancho': ancho_real,
                        })
                        
                        # Actualizar el move line correspondiente
                        move_line = self.env['stock.move.line'].search([
                            ('picking_id', '=', self.picking_id.id),
                            ('lot_id', '=', lot.id),
                            ('product_id', '=', product.id)
                        ], limit=1)
                        
                        if move_line:
                            # Recalcular qty_done con las nuevas medidas
                            qty_done = alto_real * ancho_real if (alto_real and ancho_real) else move_line.qty_done
                            
                            move_line.write({
                                'qty_done': qty_done,
                                'x_alto_temp': alto_real,
                                'x_ancho_temp': ancho_real,
                            })
                        
                        lines_updated += 1
                    
                    except (ValueError, TypeError) as e:
                        errors.append(f'Hoja {sheet_name}, Fila {row}: Error en las medidas - {str(e)}')
                        continue
        
        if lines_updated == 0:
            error_msg = 'No se actualizaron medidas. Verifique que el archivo contenga lotes válidos con medidas reales.'
            if errors:
                error_msg += '\n\nDetalles:\n' + '\n'.join(errors)
            raise UserError(error_msg)
        
        message = f'Se actualizaron {lines_updated} lotes con las medidas reales del Worksheet'
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': '¡Importación de Worksheet Exitosa!',
                'message': message,
                'type': 'success',
                'sticky': False,
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }