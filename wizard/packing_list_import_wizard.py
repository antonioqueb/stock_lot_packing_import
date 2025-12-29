# -*- coding: utf-8 -*-
from odoo import models, fields, _, api
from odoo.exceptions import UserError
import base64
import io
import json
import logging
import re

_logger = logging.getLogger(__name__)


class _PLCellsIndex:
    """Clase para normalizar el acceso a celdas de Odoo Spreadsheet"""
    
    def __init__(self):
        self._cells = {}

    def put(self, col, row, content):
        if col is not None and row is not None:
            self._cells[(int(col), int(row))] = content

    def ingest_cells(self, raw_cells):
        if not raw_cells or not isinstance(raw_cells, dict):
            return
        for key, cell_data in raw_cells.items():
            col, row = self._parse_cell_key(key)
            if col is not None and row is not None:
                content = self._extract_content(cell_data)
                self.put(col, row, content)

    def _parse_cell_key(self, key):
        if isinstance(key, str) and key and key[0].isalpha():
            match = re.match(r'^([A-Z]+)(\d+)$', key.upper())
            if match:
                col_str, row_str = match.groups()
                col = 0
                for char in col_str:
                    col = col * 26 + (ord(char) - ord('A') + 1)
                return col - 1, int(row_str) - 1
        if isinstance(key, str) and ',' in key:
            parts = key.split(',')
            if len(parts) == 2:
                try: return int(parts[0]), int(parts[1])
                except: pass
        return None, None

    def _extract_content(self, cell_data):
        if isinstance(cell_data, dict):
            return cell_data.get('content') or cell_data.get('value') or cell_data.get('text')
        return cell_data

    def apply_revision_commands(self, commands, target_sheet_id):
        applied = 0
        for cmd in commands:
            if cmd.get('sheetId') and cmd.get('sheetId') != target_sheet_id:
                continue
            if cmd.get('type') == 'UPDATE_CELL':
                col, row = cmd.get('col'), cmd.get('row')
                content = cmd.get('content')
                if col is not None and row is not None:
                    self.put(col, row, content)
                    applied += 1
        return applied

    def value(self, col, row):
        return self._cells.get((int(col), int(row)))


class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List'

    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    spreadsheet_id = fields.Many2one('documents.document', related='picking_id.spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=False, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')

    def action_import_excel(self):
        self.ensure_one()
        _logger.info("=== [PL_IMPORT] INICIO PROCESO DE LIMPIEZA Y REPROCESO ===")
        
        rows = []
        if self.excel_file:
            rows = self._get_data_from_excel_file()
        elif self.spreadsheet_id:
            rows = self._get_data_from_spreadsheet()
        
        if not rows:
            raise UserError("No se encontraron datos válidos en la hoja de cálculo.")

        # --- LIMPIEZA PROFUNDA DE INVENTARIO ---
        # 1. Obtener líneas y lotes actuales
        old_move_lines = self.picking_id.move_line_ids
        old_lots = old_move_lines.mapped('lot_id')
        
        # 2. Primero poner cantidad a 0 para que Odoo intente limpiar los Quants internamente
        old_move_lines.write({'qty_done': 0})
        self.env.flush_all() # Forzar escritura en DB
        
        # 3. Eliminar Quants de esos lotes (SUDO para evitar restricciones de permiso)
        # Esto es lo que causaba el error de foreign key
        if old_lots:
            quants = self.env['stock.quant'].sudo().search([('lot_id', 'in', old_lots.ids)])
            if quants:
                quants.unlink()
        
        # 4. Eliminar líneas de movimiento
        old_move_lines.unlink()
        
        # 5. Intentar eliminar lotes viejos uno a uno
        for lot in old_lots:
            try:
                with self.env.cr.savepoint():
                    lot.unlink()
            except Exception:
                _logger.info(f"Lote {lot.name} no pudo eliminarse (posiblemente usado en otra operación), se mantiene.")

        # --- CREACIÓN DE NUEVOS LOTES SEGÚN EXCEL ACTUAL ---
        move_lines_created = 0
        next_prefix = self._get_next_global_prefix()
        containers = {}

        for data in rows:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move:
                continue

            cont = data['contenedor'] or 'SN'
            if cont not in containers:
                containers[cont] = {
                    'pre': str(next_prefix),
                    'num': self._get_next_lot_number_for_prefix(str(next_prefix))
                }
                next_prefix += 1

            l_name = f"{containers[cont]['pre']}-{containers[cont]['num']:02d}"
            
            grupo_ids = []
            if data.get('grupo_name'):
                grupo_name = data['grupo_name'].strip()
                grupo = self.env['stock.lot.group'].search([('name', '=', grupo_name)], limit=1)
                if not grupo:
                    grupo = self.env['stock.lot.group'].create({'name': grupo_name})
                grupo_ids = [grupo.id]

            # Crear Lote
            lot = self.env['stock.lot'].create({
                'name': l_name,
                'product_id': product.id,
                'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'],
                'x_alto': data['alto'],
                'x_ancho': data['ancho'],
                'x_color': data.get('color'),
                'x_bloque': data['bloque'],
                'x_atado': data['atado'],
                'x_tipo': data['tipo'],
                'x_grupo': [(6, 0, grupo_ids)],
                'x_pedimento': data['pedimento'],
                'x_contenedor': cont,
                'x_referencia_proveedor': data['ref_proveedor'],
            })
            
            # Crear Línea de Movimiento
            self.env['stock.move.line'].create({
                'move_id': move.id,
                'product_id': product.id,
                'lot_id': lot.id,
                'qty_done': data['alto'] * data['ancho'] or 1.0,
                'location_id': self.picking_id.location_id.id,
                'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
                'x_grosor_temp': data['grosor'],
                'x_alto_temp': data['alto'],
                'x_ancho_temp': data['ancho'],
                'x_color_temp': data.get('color'),
                'x_tipo_temp': data['tipo'],
                'x_bloque_temp': data['bloque'],
                'x_atado_temp': data['atado'],
                'x_pedimento_temp': data['pedimento'],
                'x_contenedor_temp': cont,
                'x_referencia_proveedor_temp': data['ref_proveedor'],
                'x_grupo_temp': [(6, 0, grupo_ids)],
            })
            
            containers[cont]['num'] += 1
            move_lines_created += 1

        self.picking_id.write({'packing_list_imported': True})
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Actualización Exitosa',
                'message': f'Se han generado {move_lines_created} lotes (limpieza de previos realizada).',
                'type': 'success',
                'next': {'type': 'ir.actions.act_window_close'}
            }
        }

    def _get_data_from_spreadsheet(self):
        doc = self.spreadsheet_id
        spreadsheet_json = self._load_spreadsheet_json(doc)
        if not spreadsheet_json or not spreadsheet_json.get('sheets'):
            return []
        
        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'), ('res_id', '=', doc.id)
        ], order='id asc')

        all_rows = []
        for sheet in spreadsheet_json['sheets']:
            sheet_id = sheet.get('id')
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            for rev in revisions:
                try:
                    cmds = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
                    if isinstance(cmds, dict) and cmds.get('type') == 'REMOTE_REVISION':
                        idx.apply_revision_commands(cmds.get('commands', []), sheet_id)
                except: continue
            product = self._identify_product_from_sheet(idx)
            if product:
                all_rows.extend(self._extract_rows_from_index(idx, product))
        return all_rows

    def _identify_product_from_sheet(self, idx):
        p_info = idx.value(1, 0)
        if not p_info: return None
        info_str = str(p_info).strip()
        p_code = info_str.split('(')[1].split(')')[0].strip() if '(' in info_str else ""
        p_name = info_str.split('(')[0].strip()
        domain = ['|', ('name', '=', p_name), ('default_code', '=', p_name)]
        if p_code: domain = ['|', ('default_code', '=', p_code)] + domain
        return self.env['product.product'].search(domain, limit=1)

    def _extract_rows_from_index(self, idx, product):
        rows = []
        for r in range(3, 500):
            grosor_raw = idx.value(0, r)
            alto_raw = idx.value(1, r)
            ancho_raw = idx.value(2, r)
            if not grosor_raw and not alto_raw and not ancho_raw: continue
            
            alto = self._to_float(alto_raw)
            ancho = self._to_float(ancho_raw)
            if alto <= 0 or ancho <= 0: continue
            
            try:
                rows.append({
                    'product': product, 'grosor': self._to_float(grosor_raw),
                    'alto': alto, 'ancho': ancho, 'color': str(idx.value(3, r) or '').strip(),
                    'bloque': str(idx.value(4, r) or '').strip(), 'atado': str(idx.value(5, r) or '').strip(),
                    'tipo': self._parse_tipo(idx.value(6, r)), 'grupo_name': str(idx.value(7, r) or '').strip(),
                    'pedimento': str(idx.value(8, r) or '').strip(), 'contenedor': str(idx.value(9, r) or 'SN').strip(),
                    'ref_proveedor': str(idx.value(10, r) or '').strip(),
                })
            except: continue
        return rows

    def _to_float(self, val):
        if val is None or val == '': return 0.0
        try: return float(str(val).replace(',', '.'))
        except: return 0.0

    def _parse_tipo(self, val):
        v = str(val or '').lower().strip()
        return 'formato' if v == 'formato' else 'placa'

    def _get_next_global_prefix(self):
        self.env.cr.execute("""
            SELECT CAST(SUBSTRING(name FROM '^([0-9]+)-') AS INTEGER) as prefix_num
            FROM stock_lot WHERE name ~ '^[0-9]+-[0-9]+$' AND company_id = %s
            ORDER BY prefix_num DESC LIMIT 1
        """, (self.picking_id.company_id.id,))
        res = self.env.cr.fetchone()
        return (res[0] + 1) if res and res[0] else 1

    def _get_next_lot_number_for_prefix(self, prefix):
        self.env.cr.execute("""
            SELECT name FROM stock_lot WHERE name LIKE %s AND company_id = %s
            ORDER BY CAST(SUBSTRING(name FROM '-([0-9]+)$') AS INTEGER) DESC LIMIT 1
        """, (f'{prefix}-%', self.picking_id.company_id.id))
        res = self.env.cr.fetchone()
        return int(res[0].split('-')[1]) + 1 if res else 1

    def _load_spreadsheet_json(self, doc):
        if doc.spreadsheet_data:
            try:
                raw = doc.spreadsheet_data
                if isinstance(raw, bytes): raw = raw.decode('utf-8')
                return json.loads(raw)
            except: pass
        return None

    def _get_data_from_excel_file(self):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info: continue
            product = self.env['product.product'].search([('name', 'ilike', str(p_info).split('(')[0].strip())], limit=1)
            if not product: continue
            for r in range(4, sheet.max_row + 1):
                alto = self._to_float(sheet.cell(r, 2).value)
                ancho = self._to_float(sheet.cell(r, 3).value)
                if alto <= 0 or ancho <= 0: continue
                rows.append({
                    'product': product, 'grosor': self._to_float(sheet.cell(r, 1).value),
                    'alto': alto, 'ancho': ancho, 'color': str(sheet.cell(r, 4).value or '').strip(),
                    'bloque': str(sheet.cell(r, 5).value or '').strip(), 'atado': str(sheet.cell(r, 6).value or '').strip(),
                    'tipo': self._parse_tipo(sheet.cell(r, 7).value), 'grupo_name': str(sheet.cell(r, 8).value or '').strip(),
                    'pedimento': str(sheet.cell(r, 9).value or '').strip(), 'contenedor': str(sheet.cell(r, 10).value or 'SN').strip(),
                    'ref_proveedor': str(sheet.cell(r, 11).value or '').strip(),
                })
        return rows