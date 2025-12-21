# -*- coding: utf-8 -*-
from odoo import models, fields, _
from odoo.exceptions import UserError
import base64
import io
import json
import logging

_logger = logging.getLogger(__name__)

class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List (Excel o Spreadsheet)'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    # Cambiamos required=True a False porque ahora puede venir de la Spreadsheet nativa
    excel_file = fields.Binary(string='Archivo Excel', required=False, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def _get_next_global_prefix(self):
        """Obtiene el siguiente prefijo global consecutivo"""
        self.env['stock.lot'].flush_model()
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
        """Obtiene el siguiente número secuencial para un prefijo"""
        self.env['stock.lot'].flush_model()
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
        if number < 10:
            return f'{prefix}-0{number}'
        else:
            return f'{prefix}-{number}'
    
    def action_import_excel(self):
        self.ensure_one()
        
        # VALIDACIONES PREVIAS
        if self.picking_id.picking_type_code != 'incoming':
            raise UserError('Solo se puede importar en recepciones.')
        if self.picking_id.state == 'done':
             raise UserError('La recepción ya está validada. No se puede modificar.')
             
        # Determinar fuente de datos
        rows_to_process = []
        
        if self.picking_id.spreadsheet_id:
            # --- CASO 1: SPREADSHEET NATIVA (ODOO 19 ENTERPRISE) ---
            rows_to_process = self._get_data_from_spreadsheet()
        elif self.excel_file:
            # --- CASO 2: ARCHIVO EXCEL TRADICIONAL ---
            rows_to_process = self._get_data_from_excel_file()
        else:
            raise UserError('No se encontró una Hoja de Cálculo nativa ni un archivo Excel cargado.')

        if not rows_to_process:
            raise UserError('No se encontraron filas con datos para procesar.')

        # 1. LIMPIEZA DE LOTES PREVIOS (Seguro porque state != done)
        lots_to_delete = self.picking_id.move_line_ids.mapped('lot_id')
        self.picking_id.move_line_ids.unlink()
        for lot in lots_to_delete:
            if not self.env['stock.move.line'].search_count([('lot_id', '=', lot.id), ('picking_id', '!=', self.picking_id.id)]):
                lot.unlink()

        # 2. PROCESAMIENTO
        move_lines_created = 0
        next_global_prefix = self._get_next_global_prefix()
        container_counters = {}
        
        # Primero mapeamos contenedores para asignar prefijos
        for row in rows_to_process:
            cont = row.get('contenedor')
            if cont and cont not in container_counters:
                container_counters[cont] = {
                    'prefix': str(next_global_prefix),
                    'next_num': self._get_next_lot_number_for_prefix(str(next_global_prefix))
                }
                next_global_prefix += 1

        # Creación de lotes y líneas
        for data in rows_to_process:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move:
                move = self.env['stock.move'].create({
                    'name': product.name, 'product_id': product.id, 'product_uom_qty': 0,
                    'product_uom': product.uom_id.id, 'picking_id': self.picking_id.id,
                    'location_id': self.picking_id.location_id.id, 'location_dest_id': self.picking_id.location_dest_id.id,
                })

            cont = data.get('contenedor')
            prefix = container_counters[cont]['prefix']
            lot_num = container_counters[cont]['next_num']
            lot_name = self._format_lot_name(prefix, lot_num)
            
            # Evitar colisión de nombres
            while self.env['stock.lot'].search_count([('name', '=', lot_name), ('product_id', '=', product.id)]):
                lot_num += 1
                lot_name = self._format_lot_name(prefix, lot_num)

            lot = self.env['stock.lot'].create({
                'name': lot_name, 'product_id': product.id, 'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'], 'x_alto': data['alto'], 'x_ancho': data['ancho'],
                'x_bloque': data['bloque'], 'x_atado': data['atado'], 'x_tipo': data['tipo'],
                'x_pedimento': data['pedimento'], 'x_contenedor': cont, 'x_referencia_proveedor': data['ref_proveedor'],
            })
            
            self.env['stock.move.line'].create({
                'move_id': move.id, 'product_id': product.id, 'lot_id': lot.id, 'qty_done': data['alto'] * data['ancho'] or 1.0,
                'location_id': self.picking_id.location_id.id, 'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
            })
            
            container_counters[cont]['next_num'] = lot_num + 1
            move_lines_created += 1

        self.picking_id.write({'packing_list_imported': True})
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': '¡Importación Exitosa!',
                'message': f'Se crearon {move_lines_created} lotes desde la plantilla.',
                'type': 'success',
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }

    def _get_data_from_spreadsheet(self):
        """Extrae datos del JSON de Odoo Spreadsheet"""
        doc = self.picking_id.spreadsheet_id
        if not doc or not doc.spreadsheet_data:
            return []
        
        data = json.loads(doc.spreadsheet_data)
        sheet = data.get('sheets', [{}])[0]
        cells = sheet.get('cells', {})
        
        # Identificamos el producto (tomamos el primero de la recepción por defecto en Spreadsheet)
        default_product = self.picking_id.move_ids.mapped('product_id')[:1]
        if not default_product:
            return []

        rows_to_process = []
        # Odoo Spreadsheet usa índices de string. Fila 4 es índice "3"
        # Buscamos en las filas del JSON
        for row_idx_str, cols in cells.items():
            row_idx = int(row_idx_str)
            if row_idx < 3: continue # Saltamos cabeceras
            
            # Obtener contenido de celdas por índice de columna
            def get_val(col_idx):
                return cols.get(str(col_idx), {}).get('content', '')

            grosor = get_val(0)
            alto = get_val(1)
            ancho = get_val(2)
            
            if not (grosor or alto or ancho): continue

            try:
                rows_to_process.append({
                    'product': default_product,
                    'grosor': float(grosor) if grosor else 0.0,
                    'alto': float(alto) if alto else 0.0,
                    'ancho': float(ancho) if ancho else 0.0,
                    'bloque': str(get_val(3)),
                    'atado': str(get_val(4)),
                    'tipo': 'formato' if str(get_val(5)).lower() == 'formato' else 'placa',
                    'pedimento': str(get_val(6)),
                    'contenedor': str(get_val(7)).strip(),
                    'ref_proveedor': str(get_val(8)),
                })
            except: continue
            
        return rows_to_process

    def _get_data_from_excel_file(self):
        """Mantiene la lógica original de lectura de archivo Excel"""
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise UserError('Instale openpyxl')
            
        excel_data = base64.b64decode(self.excel_file)
        wb = load_workbook(io.BytesIO(excel_data), data_only=True)
        rows_to_process = []

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            product_info = ws['B1'].value
            if not product_info: continue
            
            # Extraer producto (Misma lógica original)
            product_code = None
            if '(' in str(product_info):
                product_code = str(product_info).split('(')[1].split(')')[0].strip()
            
            product = self.env['product.product'].search([('|'), ('default_code', '=', product_code), ('barcode', '=', product_code)], limit=1)
            if not product:
                name = str(product_info).split('(')[0].strip()
                product = self.env['product.product'].search([('name', 'ilike', name)], limit=1)
            
            if not product: continue

            for row in range(4, ws.max_row + 1):
                g_val = ws.cell(row=row, column=1).value
                if g_val is None: continue
                
                rows_to_process.append({
                    'product': product,
                    'grosor': float(g_val or 0),
                    'alto': float(ws.cell(row=row, column=2).value or 0),
                    'ancho': float(ws.cell(row=row, column=3).value or 0),
                    'bloque': str(ws.cell(row=row, column=4).value or ''),
                    'atado': str(ws.cell(row=row, column=5).value or ''),
                    'tipo': 'formato' if str(ws.cell(row=row, column=6).value).lower() == 'formato' else 'placa',
                    'pedimento': str(ws.cell(row=row, column=7).value or ''),
                    'contenedor': str(ws.cell(row=row, column=8).value or '').strip(),
                    'ref_proveedor': str(ws.cell(row=row, column=9).value or ''),
                })
        return rows_to_process