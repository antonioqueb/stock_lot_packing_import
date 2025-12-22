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
    
    # ---------------------------------------------------------
    # LÓGICA DE NUMERACIÓN (Mantenida por estabilidad)
    # ---------------------------------------------------------
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

    # ---------------------------------------------------------
    # ACCIÓN DE IMPORTACIÓN (EL MOTOR)
    # ---------------------------------------------------------
    def action_import_excel(self):
        self.ensure_one()
        _logger.info("=== PROCESANDO CARGA DE LOTES ===")
        
        rows_to_process = []
        # Si hay un archivo manual, tiene prioridad total
        if self.excel_file:
            rows_to_process = self._get_data_from_excel_file()
        # Si no, intentamos leer la hoja de cálculo
        elif self.picking_id.spreadsheet_id:
            rows_to_process = self._get_data_from_spreadsheet()
        else:
            raise UserError('No hay datos. Cargue un archivo Excel o llene la plantilla PL.')

        if not rows_to_process:
            raise UserError('No se detectaron datos en las filas. Si usó la hoja de cálculo, asegúrese de hacer clic fuera de la celda antes de cerrar para que Odoo guarde los cambios.')

        # Limpieza de líneas previas
        self.picking_id.move_line_ids.unlink()

        # Procesamiento
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
            
            # Evitar duplicados
            while self.env['stock.lot'].search_count([('name', '=', lot_name), ('product_id', '=', product.id)]):
                lot_num += 1
                lot_name = self._format_lot_name(prefix, lot_num)

            lot = self.env['stock.lot'].create({
                'name': lot_name, 'product_id': product.id, 'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'], 'x_alto': data['alto'], 'x_ancho': data['ancho'],
                'x_bloque': data['bloque'], 'x_atado': data['atado'], 'x_tipo': data['tipo'],
                'x_pedimento': data['pedimento'], 'x_contenedor': cont, 'x_referencia_proveedor': data['ref_proveedor'],
            })
            
            self.env['stock.move_line'].create({
                'move_id': move.id, 'product_id': product.id, 'lot_id': lot.id, 'qty_done': data['alto'] * data['ancho'] or 1.0,
                'location_id': self.picking_id.location_id.id, 'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
            })
            container_counters[cont]['next_num'] = lot_num + 1
            move_lines_created += 1

        self.picking_id.write({'packing_list_imported': True})
        return {'type': 'ir.actions.client', 'tag': 'display_notification', 'params': {
            'title': 'Éxito', 'message': f'Importación finalizada: {move_lines_created} lotes creados.',
            'type': 'success', 'next': {'type': 'ir.actions.act_window_close'}
        }}

    # ---------------------------------------------------------
    # LECTOR SPREADSHEET (SOPORTE REVISIONES AGRESIVO)
    # ---------------------------------------------------------
    def _get_data_from_spreadsheet(self):
        doc = self.picking_id.spreadsheet_id
        # Intentamos obtener la data consolidada
        try:
            # En Odoo 19, action_open a veces dispara el flush de revisiones
            raw_data = doc.spreadsheet_data
            if isinstance(raw_data, bytes): raw_data = raw_data.decode('utf-8')
            data_json = json.loads(raw_data or '{}')
        except:
            data_json = {}

        sheets = data_json.get('sheets', [])
        cells = sheets[0].get('cells', {}) if sheets else {}

        # REVISIONES: Buscamos cualquier cambio reciente en los modelos vinculados
        # Odoo 19 suele usar res_id del documento o el ID interno del recurso
        revs = self.env['spreadsheet.revision'].sudo().search([
            '|', ('res_id', '=', doc.id), ('res_id', '=', self.picking_id.id)
        ], order='id asc')

        _logger.info(f"LOG: Procesando {len(revs)} revisiones encontradas en DB.")
        for rev in revs:
            try:
                for cmd in json.loads(rev.commands):
                    if cmd.get('type') in ('UPDATE_CELL', 'SET_CELL_CONTENT'):
                        col, row = cmd.get('col'), cmd.get('row')
                        val = cmd.get('content') or cmd.get('cell', {}).get('content')
                        if col is not None and row is not None:
                            cells[f"{col},{row}"] = {'content': val}
            except: continue

        rows = []
        default_product = self.picking_id.move_ids.mapped('product_id')[:1]
        col_map = {'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8}

        for r in range(4, 501):
            row_idx = r - 1
            def gv(col_letter):
                c_idx = col_map[col_letter]
                # Búsqueda en todos los formatos de llave de Odoo
                cell = cells.get(f"{c_idx},{row_idx}") or cells.get(f"{col_letter}{r}")
                if not cell:
                    row_data = cells.get(str(row_idx)) or cells.get(row_idx)
                    if isinstance(row_data, dict):
                        cell = row_data.get(str(c_idx)) or row_data.get(c_idx)
                if not cell: return None
                return cell.get('content') or cell.get('value')

            g, a, an = gv('A'), gv('B'), gv('C')
            if g is None and a is None: continue # Fila vacía

            try:
                rows.append({
                    'product': default_product,
                    'grosor': float(str(g or 0).replace(',', '.')),
                    'alto': float(str(a or 0).replace(',', '.')),
                    'ancho': float(str(an or 0).replace(',', '.')),
                    'bloque': str(gv('D') or '').strip(),
                    'atado': str(gv('E') or '').strip(),
                    'tipo': 'formato' if str(gv('F') or '').lower() == 'formato' else 'placa',
                    'pedimento': str(gv('G') or '').strip(),
                    'contenedor': str(gv('H') or 'SN').strip(),
                    'ref_proveedor': str(gv('I') or '').strip(),
                })
            except: continue
        return rows

    # ---------------------------------------------------------
    # LECTOR EXCEL (EL MÉTODO INFALIBLE)
    # ---------------------------------------------------------
    def _get_data_from_excel_file(self):
        try:
            from openpyxl import load_workbook
        except:
            raise UserError('Instale openpyxl')
        
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info: continue
            # Buscar producto por código en paréntesis o nombre
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