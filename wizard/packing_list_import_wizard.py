# -*- coding: utf-8 -*-
from odoo import models, fields, _, api
from odoo.exceptions import UserError
import base64
import io
import json
import logging

_logger = logging.getLogger(__name__)

class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    spreadsheet_id = fields.Many2one('documents.document', related='picking_id.spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=False, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')

    # --- Lógica de Numeración de Lotes ---
    def _get_next_global_prefix(self):
        self.env.cr.execute("""
            SELECT CAST(SUBSTRING(sl.name FROM '^([0-9]+)-') AS INTEGER) as prefix_num
            FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name ~ '^[0-9]+-[0-9]+$' AND sp.state = 'done' AND sp.company_id = %s
            ORDER BY prefix_num DESC LIMIT 1
        """, (self.picking_id.company_id.id,))
        result = self.env.cr.fetchone()
        return (result[0] + 1) if result and result[0] else 1
    
    def _get_next_lot_number_for_prefix(self, prefix):
        self.env.cr.execute("""
            SELECT sl.name FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name LIKE %s AND sp.state = 'done' AND sp.company_id = %s
            ORDER BY CAST(SUBSTRING(sl.name FROM '-([0-9]+)$') AS INTEGER) DESC LIMIT 1
        """, (f'{prefix}-%', self.picking_id.company_id.id))
        result = self.env.cr.fetchone()
        if result:
            try: return int(result[0].split('-')[1]) + 1
            except: pass
        return 1
    
    def _format_lot_name(self, prefix, number):
        return f'{prefix}-{number:02d}' if number < 100 else f'{prefix}-{number}'

    # --- Acción Principal ---
    def action_import_excel(self):
        self.ensure_one()
        _logger.info("=== INICIANDO PROCESO DE IMPORTACIÓN ===")
        
        rows_to_process = []
        if self.excel_file:
            _logger.info("Modo: Archivo Excel Manual")
            rows_to_process = self._get_data_from_excel_file()
        elif self.picking_id.spreadsheet_id:
            _logger.info("Modo: Odoo Spreadsheet (ID: %s)", self.picking_id.spreadsheet_id.id)
            rows_to_process = self._get_data_from_spreadsheet()
        else:
            raise UserError('No hay datos. Cargue un archivo Excel o llene la plantilla PL.')

        if not rows_to_process:
            _logger.warning("No se encontraron filas válidas para procesar.")
            raise UserError('No se detectaron datos. Asegúrese de haber llenado las columnas de Grosor, Alto y Ancho.')

        # Limpiar líneas previas
        self.picking_id.move_line_ids.unlink()

        # Procesamiento de Lotes
        move_lines_created = 0
        next_global_prefix = self._get_next_global_prefix()
        container_counters = {}
        
        for data in rows_to_process:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move: continue

            cont = data['contenedor'] or 'SN'
            if cont not in container_counters:
                container_counters[cont] = {
                    'prefix': str(next_global_prefix),
                    'next_num': self._get_next_lot_number_for_prefix(str(next_global_prefix))
                }
                next_global_prefix += 1

            prefix = container_counters[cont]['prefix']
            lot_num = container_counters[cont]['next_num']
            lot_name = self._format_lot_name(prefix, lot_num)
            
            # Crear Lote
            lot = self.env['stock.lot'].create({
                'name': lot_name, 'product_id': product.id, 'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'], 'x_alto': data['alto'], 'x_ancho': data['ancho'],
                'x_bloque': data['bloque'], 'x_atado': data['atado'], 'x_tipo': data['tipo'],
                'x_pedimento': data['pedimento'], 'x_contenedor': cont, 'x_referencia_proveedor': data['ref_proveedor'],
            })
            
            # Crear Línea de Movimiento
            self.env['stock.move_line'].create({
                'move_id': move.id, 'product_id': product.id, 'lot_id': lot.id, 
                'qty_done': data['alto'] * data['ancho'] or 1.0,
                'location_id': self.picking_id.location_id.id, 
                'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
            })
            container_counters[cont]['next_num'] = lot_num + 1
            move_lines_created += 1

        self.picking_id.write({'packing_list_imported': True})
        _logger.info("Importación finalizada. %s lotes creados.", move_lines_created)
        
        return {'type': 'ir.actions.client', 'tag': 'display_notification', 'params': {
            'title': 'Éxito', 'message': f'Importación finalizada: {move_lines_created} lotes creados.',
            'type': 'success', 'next': {'type': 'ir.actions.act_window_close'}
        }}

    # --- LECTOR DE SPREADSHEET (DEBUG TOTAL) ---
    def _get_data_from_spreadsheet(self):
        doc = self.picking_id.spreadsheet_id
        
        # 1. Obtener datos base (Snapshot)
        raw_data = doc.spreadsheet_data
        if isinstance(raw_data, bytes): raw_data = raw_data.decode('utf-8')
        data_json = json.loads(raw_data or '{}')
        
        sheets = data_json.get('sheets', [])
        # En Odoo 19 los cells suelen estar en sheets[0]['cells']
        cells = sheets[0].get('cells', {}) if sheets else {}
        _logger.info("DEBUG: Celdas base encontradas en snapshot: %s", len(cells))

        # 2. Aplicar Revisiones (Lo que el usuario escribió pero no se ha guardado en el documento base)
        # Buscamos revisiones por res_id (ID del documento)
        revisions = self.env['spreadsheet.revision'].sudo().search([
            ('res_id', '=', doc.id),
            ('res_model', '=', 'documents.document')
        ], order='id asc')
        
        _logger.info("DEBUG: Procesando %s revisiones de la base de datos.", len(revisions))
        
        for rev in revisions:
            try:
                commands = json.loads(rev.commands)
                for cmd in commands:
                    # Comandos típicos de cambio de celda
                    if cmd.get('type') in ('UPDATE_CELL', 'SET_CELL_CONTENT'):
                        col = cmd.get('col')
                        row = cmd.get('row')
                        content = cmd.get('content') or cmd.get('cell', {}).get('content', '')
                        
                        # Guardamos en nuestro mapa temporal (formato "col,row")
                        cells[f"{col},{row}"] = {'content': content}
                        # También guardamos formato objeto por si el snapshot usa otro estilo
                        if str(row) not in cells: cells[str(row)] = {}
                        cells[str(row)][str(col)] = {'content': content}
            except Exception as e:
                _logger.error("Error procesando revisión %s: %s", rev.id, e)

        # 3. Mapear filas a datos de negocio
        rows = []
        default_product = self.picking_id.move_ids.mapped('product_id')[:1]
        
        # Odoo Spreadsheet usa índices 0-based. 
        # Si la cabecera está en la fila 3 (index 2), los datos empiezan en fila 4 (index 3).
        # Col A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8
        
        for r_idx in range(3, 500): # Escanear hasta 500 filas
            def get_val(c_idx):
                # Intentar varios formatos de acceso que Odoo usa internamente
                cell = (
                    cells.get(f"{c_idx},{r_idx}") or 
                    cells.get(str(r_idx), {}).get(str(c_idx)) or
                    cells.get(r_idx, {}).get(c_idx)
                )
                if not cell: return None
                val = cell.get('content') or cell.get('value') or ''
                # Si es una fórmula o número, a veces viene como string con "=" o solo el valor
                return str(val).strip()

            g_val = get_val(0) # Grosor
            a_val = get_val(1) # Alto
            an_val = get_val(2) # Ancho

            # Si las tres columnas críticas están vacías, paramos o saltamos
            if not g_val and not a_val and not an_val:
                continue

            _logger.info("DEBUG: Fila %s detectada -> G:%s, A:%s, An:%s", r_idx + 1, g_val, a_val, an_val)

            try:
                rows.append({
                    'product': default_product,
                    'grosor': float(g_val.replace(',', '.')) if g_val else 0.0,
                    'alto': float(a_val.replace(',', '.')) if a_val else 0.0,
                    'ancho': float(an_val.replace(',', '.')) if an_val else 0.0,
                    'bloque': get_val(3) or '',
                    'atado': get_val(4) or '',
                    'tipo': 'formato' if (get_val(5) or '').lower() == 'formato' else 'placa',
                    'pedimento': get_val(6) or '',
                    'contenedor': get_val(7) or 'SN',
                    'ref_proveedor': get_val(8) or '',
                })
            except Exception as e:
                _logger.warning("Fila %s descartada por error de formato: %s", r_idx + 1, e)
                continue
                
        return rows

    def _get_data_from_excel_file(self):
        # (Se mantiene igual que tu versión, es la parte que ya funciona bien)
        try:
            from openpyxl import load_workbook
        except: raise UserError('Instale openpyxl')
        
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info: continue
            p_code = str(p_info).split('(')[1].split(')')[0].strip() if '(' in str(p_info) else ''
            product = self.env['product.product'].search(['|', ('default_code', '=', p_code), ('name', '=', str(p_info).split('(')[0].strip())], limit=1)
            if not product: continue

            for r in range(4, sheet.max_row + 1):
                if not sheet.cell(r, 1).value and not sheet.cell(r, 2).value: continue
                rows.append({
                    'product': product,
                    'grosor': float(sheet.cell(r, 1).value or 0),
                    'alto': float(sheet.cell(r, 2).value or 0),
                    'ancho': float(sheet.cell(r, 3).value or 0),
                    'bloque': str(sheet.cell(r, 4).value or ''),
                    'atado': str(sheet.cell(r, 5).value or ''),
                    'tipo': 'formato' if str(sheet.cell(r, 6).value).lower() == 'formato' else 'placa',
                    'pedimento': str(sheet.cell(r, 7).value or ''),
                    'contenedor': str(sheet.cell(r, 8).value or 'SN').strip(),
                    'ref_proveedor': str(sheet.cell(r, 9).value or ''),
                })
        return rows