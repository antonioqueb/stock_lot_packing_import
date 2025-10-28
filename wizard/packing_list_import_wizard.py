# -*- coding: utf-8 -*-
from odoo import models, fields
from odoo.exceptions import UserError
import base64
import io
import re

class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List Excel'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=True, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def _get_next_lot_number_global(self):
        """Obtener el siguiente número de lote GLOBAL (no por producto)"""
        last_lot = self.env['stock.lot'].search([], order='name desc', limit=1)
        if last_lot:
            match = re.search(r'^(\d+)$', last_lot.name)
            if match:
                return int(match.group(1)) + 1
        return 1
    
    def _format_lot_name(self, number):
        return f'{number:05d}'
    
    def action_import_excel(self):
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
        
        # ============================================================================
        # NUEVO: Eliminar las líneas de movimiento sin lote asignado
        # ============================================================================
        move_lines_without_lot = self.picking_id.move_line_ids.filtered(lambda ml: not ml.lot_id)
        if move_lines_without_lot:
            move_lines_without_lot.unlink()
        # ============================================================================
        
        move_lines_created = 0
        errors = []
        
        # Obtener el número inicial GLOBAL una sola vez
        next_lot_num = self._get_next_lot_number_global()
        
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            product_info = ws['B1'].value
            if not product_info:
                errors.append(f'Hoja {sheet_name}: No se encontró información del producto en B1')
                continue
            
            # Extraer código del producto o usar el nombre de la hoja
            product_code = None
            if '(' in str(product_info) and ')' in str(product_info):
                code_part = str(product_info).split('(')[1].split(')')[0].strip()
                if code_part:
                    product_code = code_part
            
            # Si no hay código en paréntesis, extraer el nombre del producto antes del paréntesis
            if not product_code:
                product_name = str(product_info).split('(')[0].strip()
                # Buscar por nombre
                product = self.env['product.product'].search([
                    ('name', 'ilike', product_name)
                ], limit=1)
                if not product:
                    errors.append(f'Hoja {sheet_name}: No se encontró el producto "{product_name}"')
                    continue
            else:
                # Buscar por código
                product = self.env['product.product'].search([
                    '|', ('default_code', '=', product_code), ('barcode', '=', product_code)
                ], limit=1)
                if not product:
                    errors.append(f'Hoja {sheet_name}: No se encontró el producto con código "{product_code}"')
                    continue
            
            # Buscar o crear el move
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)
            if not move:
                move = self.env['stock.move'].create({
                    'name': product.name,
                    'product_id': product.id,
                    'product_uom_qty': 0,
                    'product_uom': product.uom_id.id,
                    'picking_id': self.picking_id.id,
                    'location_id': self.picking_id.location_id.id,
                    'location_dest_id': self.picking_id.location_dest_id.id,
                })
            
            rows_processed = 0
            for row in range(4, ws.max_row + 1):
                grosor_val = ws.cell(row=row, column=1).value
                alto_val = ws.cell(row=row, column=2).value
                ancho_val = ws.cell(row=row, column=3).value
                
                if grosor_val is None and alto_val is None and ancho_val is None:
                    continue
                
                try:
                    grosor = float(grosor_val) if grosor_val is not None else 0.0
                    alto = float(alto_val) if alto_val is not None else 0.0
                    ancho = float(ancho_val) if ancho_val is not None else 0.0
                except (ValueError, TypeError):
                    continue
                
                bloque_val = ws.cell(row=row, column=4).value
                formato_val = ws.cell(row=row, column=5).value
                
                # Convertir bloque (puede venir como float 567.0)
                if bloque_val is not None:
                    if isinstance(bloque_val, (int, float)):
                        bloque = str(int(bloque_val))
                    else:
                        bloque = str(bloque_val).strip()
                else:
                    bloque = ''
                
                # Formato
                if formato_val is not None:
                    formato = str(formato_val).strip().lower()
                else:
                    formato = 'placa'
                
                # Crear lote con numeración global continua
                lot_name = self._format_lot_name(next_lot_num)
                lot = self.env['stock.lot'].create({
                    'name': lot_name,
                    'product_id': product.id,
                    'company_id': self.picking_id.company_id.id,
                    'x_grosor': grosor,
                    'x_alto': alto,
                    'x_ancho': ancho,
                    'x_bloque': bloque,
                    'x_formato': formato,
                })
                
                qty_done = alto * ancho if (alto and ancho) else 1.0
                
                self.env['stock.move.line'].create({
                    'move_id': move.id,
                    'product_id': product.id,
                    'lot_id': lot.id,
                    'product_uom_id': product.uom_id.id,
                    'location_id': self.picking_id.location_id.id,
                    'location_dest_id': self.picking_id.location_dest_id.id,
                    'picking_id': self.picking_id.id,
                    'qty_done': qty_done,
                    'x_grosor_temp': grosor,
                    'x_alto_temp': alto,
                    'x_ancho_temp': ancho,
                    'x_bloque_temp': bloque,
                    'x_formato_temp': formato,
                })
                
                # Incrementar el contador GLOBAL
                next_lot_num += 1
                move_lines_created += 1
                rows_processed += 1
        
        if move_lines_created == 0:
            error_msg = 'No se encontraron datos válidos en el archivo Excel'
            if errors:
                error_msg += '\n\nDetalles:\n' + '\n'.join(errors)
            raise UserError(error_msg)
        
        # IMPORTANTE: Marcar que el Packing List ya fue importado
        self.picking_id.write({'packing_list_imported': True})
        
        message = f'Se crearon {move_lines_created} lotes con numeración automática'
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': '¡Importación Exitosa!',
                'message': message,
                'type': 'success',
                'sticky': False,
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }