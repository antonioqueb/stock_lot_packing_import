# -*- coding: utf-8 -*-
from odoo import models, fields
from odoo.exceptions import UserError
import base64
import io
import re
from datetime import datetime

class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List Excel'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=True, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def _get_next_global_prefix(self):
        """Obtiene el siguiente prefijo global consecutivo (solo de recepciones VALIDADAS de la compañía actual)"""
        self.env['stock.lot'].flush_model()
        
        # Buscar el último prefijo usado en recepciones validadas DE LA COMPAÑÍA ACTUAL
        self.env.cr.execute("""
            SELECT CAST(SUBSTRING(sl.name FROM '^([0-9]+)-') AS INTEGER) as prefix_num
            FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name ~ '^[0-9]+-[0-9]+$'
            AND sp.state = 'done'
            AND sp.company_id = %s
            ORDER BY prefix_num DESC
            LIMIT 1
        """, (self.picking_id.company_id.id,))
        
        result = self.env.cr.fetchone()
        
        if result and result[0]:
            return result[0] + 1
        
        return 1
    
    def _get_next_lot_number_for_prefix(self, prefix):
        """Obtiene el siguiente número secuencial para un prefijo específico (solo VALIDADOS de la compañía actual)"""
        self.env['stock.lot'].flush_model()
        
        # Buscar el último lote con este prefijo en RECEPCIONES VALIDADAS DE LA COMPAÑÍA ACTUAL
        self.env.cr.execute("""
            SELECT sl.name
            FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name LIKE %s
            AND sp.state = 'done'
            AND sp.company_id = %s
            ORDER BY CAST(SUBSTRING(sl.name FROM '-([0-9]+)$') AS INTEGER) DESC
            LIMIT 1
        """, (f'{prefix}-%', self.picking_id.company_id.id))
        
        result = self.env.cr.fetchone()
        
        if result:
            try:
                last_num = int(result[0].split('-')[1])
                return last_num + 1
            except (ValueError, IndexError):
                pass
        
        return 1
    
    def _format_lot_name(self, prefix, number):
        """Formato: PREFIJO-NN (ej: 1-01, 1-02, ..., 1-99, 1-100)"""
        if number < 10:
            return f'{prefix}-0{number}'
        else:
            return f'{prefix}-{number}'
    
    def action_import_excel(self):
        self.ensure_one()
        
        if not self.excel_file:
            raise UserError('Debe seleccionar un archivo Excel')
        
        if self.picking_id.picking_type_code != 'incoming':
            raise UserError('Solo se puede importar en recepciones')
        
        # CRÍTICO: Si la recepción NO está validada, eliminar lotes anteriores de esta recepción
        if self.picking_id.state != 'done':
            lots_to_delete = self.picking_id.move_line_ids.mapped('lot_id')
            self.picking_id.move_line_ids.unlink()
            
            for lot in lots_to_delete:
                other_moves = self.env['stock.move.line'].search([
                    ('lot_id', '=', lot.id),
                    ('picking_id', '!=', self.picking_id.id)
                ])
                if not other_moves:
                    lot.unlink()
        else:
            raise UserError('No puede reimportar el Packing List en una recepción ya validada. Cree una nueva recepción.')
        
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        try:
            excel_data = base64.b64decode(self.excel_file)
            wb = load_workbook(io.BytesIO(excel_data))
        except Exception as e:
            raise UserError(f'Error al leer el archivo Excel: {str(e)}')
        
        move_lines_created = 0
        errors = []
        
        # Obtener el siguiente prefijo global
        next_global_prefix = self._get_next_global_prefix()
        
        # Mapeo de contenedor -> prefijo asignado
        container_to_prefix = {}
        container_counters = {}
        
        # Primera pasada: identificar contenedores únicos y asignarles prefijos consecutivos
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            for row in range(4, ws.max_row + 1):
                contenedor_val = ws.cell(row=row, column=8).value
                
                if contenedor_val is None or str(contenedor_val).strip() == '':
                    continue
                
                if isinstance(contenedor_val, (int, float)):
                    contenedor = str(int(contenedor_val))
                else:
                    contenedor = str(contenedor_val).strip()
                
                if contenedor and contenedor not in container_to_prefix:
                    # Asignar el siguiente prefijo consecutivo
                    container_to_prefix[contenedor] = str(next_global_prefix)
                    container_counters[contenedor] = {
                        'prefix': str(next_global_prefix),
                        'next_num': self._get_next_lot_number_for_prefix(str(next_global_prefix))
                    }
                    next_global_prefix += 1
        
        # Segunda pasada: procesar productos y crear lotes
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
                if not product:
                    errors.append(f'Hoja {sheet_name}: No se encontró el producto "{product_name}"')
                    continue
            else:
                product = self.env['product.product'].search([
                    '|', ('default_code', '=', product_code), ('barcode', '=', product_code)
                ], limit=1)
                if not product:
                    errors.append(f'Hoja {sheet_name}: No se encontró el producto con código "{product_code}"')
                    continue
            
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
                atado_val = ws.cell(row=row, column=5).value
                tipo_val = ws.cell(row=row, column=6).value
                pedimento_val = ws.cell(row=row, column=7).value
                contenedor_val = ws.cell(row=row, column=8).value
                ref_proveedor_val = ws.cell(row=row, column=9).value
                
                if contenedor_val is None or str(contenedor_val).strip() == '':
                    errors.append(f'Hoja {sheet_name}, Fila {row}: Falta número de contenedor')
                    continue
                
                if bloque_val is not None:
                    bloque = str(int(bloque_val)) if isinstance(bloque_val, (int, float)) else str(bloque_val).strip()
                else:
                    bloque = ''
                
                if atado_val is not None:
                    atado = str(int(atado_val)) if isinstance(atado_val, (int, float)) else str(atado_val).strip()
                else:
                    atado = ''
                
                if tipo_val is not None:
                    tipo_str = str(tipo_val).strip().lower()
                    tipo = 'formato' if tipo_str == 'formato' else 'placa'
                else:
                    tipo = 'placa'
                
                if pedimento_val is not None:
                    pedimento = str(int(pedimento_val)) if isinstance(pedimento_val, (int, float)) else str(pedimento_val).strip()
                else:
                    pedimento = ''
                
                if isinstance(contenedor_val, (int, float)):
                    contenedor = str(int(contenedor_val))
                else:
                    contenedor = str(contenedor_val).strip()
                
                if ref_proveedor_val is not None:
                    ref_proveedor = str(ref_proveedor_val).strip()
                else:
                    ref_proveedor = ''
                
                # Obtener el prefijo asignado a este contenedor
                prefix = container_counters[contenedor]['prefix']
                lot_number = container_counters[contenedor]['next_num']
                lot_name = self._format_lot_name(prefix, lot_number)
                
                existing_lot = self.env['stock.lot'].search([
                    ('name', '=', lot_name),
                    ('product_id', '=', product.id)
                ], limit=1)
                
                while existing_lot:
                    lot_number += 1
                    lot_name = self._format_lot_name(prefix, lot_number)
                    existing_lot = self.env['stock.lot'].search([
                        ('name', '=', lot_name),
                        ('product_id', '=', product.id)
                    ], limit=1)
                
                lot = self.env['stock.lot'].create({
                    'name': lot_name,
                    'product_id': product.id,
                    'company_id': self.picking_id.company_id.id,
                    'x_grosor': grosor,
                    'x_alto': alto,
                    'x_ancho': ancho,
                    'x_bloque': bloque,
                    'x_atado': atado,
                    'x_tipo': tipo,
                    'x_pedimento': pedimento,
                    'x_contenedor': contenedor,
                    'x_referencia_proveedor': ref_proveedor,
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
                    'x_atado_temp': atado,
                    'x_tipo_temp': tipo,
                    'x_pedimento_temp': pedimento,
                    'x_contenedor_temp': contenedor,
                    'x_referencia_proveedor_temp': ref_proveedor,
                })
                
                container_counters[contenedor]['next_num'] += 1
                move_lines_created += 1
        
        if move_lines_created == 0:
            error_msg = 'No se encontraron datos válidos en el archivo Excel'
            if errors:
                error_msg += '\n\nDetalles:\n' + '\n'.join(errors)
            raise UserError(error_msg)
        
        self.picking_id.write({'packing_list_imported': True})
        
        containers_summary = '\n'.join([
            f"- Contenedor {cont}: Prefijo {data['prefix']}"
            for cont, data in container_counters.items()
        ])
        
        message = f'Se crearon {move_lines_created} lotes\n\nResumen por contenedor:\n{containers_summary}'
        
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