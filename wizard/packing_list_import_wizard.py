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
        """Almacena contenido en coordenadas (col, row) base 0"""
        if col is not None and row is not None:
            self._cells[(int(col), int(row))] = content

    def ingest_cells(self, raw_cells):
        """Procesa el dict de celdas del JSON de Odoo"""
        if not raw_cells or not isinstance(raw_cells, dict):
            return
        
        for key, cell_data in raw_cells.items():
            col, row = self._parse_cell_key(key)
            if col is not None and row is not None:
                content = self._extract_content(cell_data)
                self.put(col, row, content)

    def _parse_cell_key(self, key):
        """Convierte 'A1', '0,3', etc. a (col, row) base 0"""
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
                try:
                    return int(parts[0]), int(parts[1])
                except ValueError:
                    pass
        
        return None, None

    def _extract_content(self, cell_data):
        """Extrae el contenido de una celda"""
        if isinstance(cell_data, dict):
            return cell_data.get('content') or cell_data.get('value') or cell_data.get('text')
        return cell_data

    def apply_revision_commands(self, commands):
        """Aplica comandos de revisión sobre las celdas"""
        if not commands:
            return 0
        
        applied = 0
        for cmd in commands:
            cmd_type = cmd.get('type', '')
            if cmd_type == 'UPDATE_CELL':
                col = cmd.get('col')
                row = cmd.get('row')
                content = cmd.get('content')
                if col is not None and row is not None:
                    self.put(col, row, content)
                    applied += 1
        return applied

    def value(self, col, row):
        """Obtiene el valor de una celda"""
        return self._cells.get((int(col), int(row)))


class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List'

    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    spreadsheet_id = fields.Many2one('documents.document', related='picking_id.spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=False, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')

    def _get_next_global_prefix(self):
        """
        Busca el prefijo más alto en TODA la tabla de lotes de la compañía.
        Se eliminó el filtro de picking 'done' para evitar duplicados entre recepciones abiertas.
        """
        self.env.cr.execute("""
            SELECT CAST(SUBSTRING(name FROM '^([0-9]+)-') AS INTEGER) as prefix_num
            FROM stock_lot
            WHERE name ~ '^[0-9]+-[0-9]+$' AND company_id = %s
            ORDER BY prefix_num DESC LIMIT 1
        """, (self.picking_id.company_id.id,))
        res = self.env.cr.fetchone()
        return (res[0] + 1) if res and res[0] else 1

    def _get_next_lot_number_for_prefix(self, prefix):
        """
        Busca el siguiente número para un prefijo en toda la tabla de lotes.
        """
        self.env.cr.execute("""
            SELECT name FROM stock_lot
            WHERE name LIKE %s AND company_id = %s
            ORDER BY CAST(SUBSTRING(name FROM '-([0-9]+)$') AS INTEGER) DESC LIMIT 1
        """, (f'{prefix}-%', self.picking_id.company_id.id))
        res = self.env.cr.fetchone()
        return int(res[0].split('-')[1]) + 1 if res else 1

    def action_import_excel(self):
        self.ensure_one()
        _logger.info("=== [PL_IMPORT] INICIO PROCESO ===")
        
        rows = []
        if self.excel_file:
            rows = self._get_data_from_excel_file()
        elif self.spreadsheet_id:
            rows = self._get_data_from_spreadsheet()
        
        if not rows:
            raise UserError("No se encontraron datos.")

        # Limpiar líneas previas de esta recepción para permitir re-importación
        self.picking_id.move_line_ids.unlink()
        
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
            
            # --- LÓGICA PARA GRUPO ---
            grupo_ids = []
            if data.get('grupo_name'):
                grupo_name = data['grupo_name'].strip()
                grupo = self.env['stock.lot.group'].search([('name', '=', grupo_name)], limit=1)
                if not grupo:
                    grupo = self.env['stock.lot.group'].create({'name': grupo_name})
                grupo_ids = [grupo.id]

            # Crear el Lote
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
            
            # Crear la línea de movimiento con campos TEMP para visibilidad
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
                'title': 'Éxito',
                'message': f'Importados {move_lines_created} lotes correctamente.',
                'type': 'success',
                'next': {'type': 'ir.actions.act_window_close'}
            }
        }

    def _get_data_from_spreadsheet(self):
        doc = self.spreadsheet_id
        spreadsheet_json = self._load_spreadsheet_json(doc)
        if not spreadsheet_json or not spreadsheet_json.get('sheets'):
            return []
        
        first_sheet = spreadsheet_json['sheets'][0]
        idx = _PLCellsIndex()
        idx.ingest_cells(first_sheet.get('cells', {}))
        self._apply_all_revisions(doc, idx)
        
        return self._extract_rows_from_index(idx)

    def _load_spreadsheet_json(self, doc):
        if doc.attachment_id and doc.attachment_id.datas:
            try:
                raw_bytes = base64.b64decode(doc.attachment_id.datas)
                return json.loads(raw_bytes.decode('utf-8'))
            except: pass
        if doc.spreadsheet_data:
            try:
                raw = doc.spreadsheet_data
                if isinstance(raw, bytes): raw = raw.decode('utf-8')
                return json.loads(raw)
            except: pass
        return None

    def _apply_all_revisions(self, doc, idx):
        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id)
        ], order='id asc')
        for rev in revisions:
            try:
                raw_commands = rev.commands
                if not raw_commands: continue
                parsed = json.loads(raw_commands) if isinstance(raw_commands, str) else raw_commands
                if parsed.get('type') == 'REMOTE_REVISION':
                    idx.apply_revision_commands(parsed.get('commands', []))
            except: continue

    def _extract_rows_from_index(self, idx):
        rows = []
        prod = self.picking_id.move_ids.mapped('product_id')[:1]
        if not prod: return []
        
        for row_idx in range(3, 103):
            grosor_val = idx.value(0, row_idx)
            if not grosor_val: continue
            
            try:
                rows.append({
                    'product': prod,
                    'grosor': self._to_float(grosor_val),
                    'alto': self._to_float(idx.value(1, row_idx)),
                    'ancho': self._to_float(idx.value(2, row_idx)),
                    'color': str(idx.value(3, row_idx) or '').strip(),
                    'bloque': str(idx.value(4, row_idx) or '').strip(),
                    'atado': str(idx.value(5, row_idx) or '').strip(),
                    'tipo': self._parse_tipo(idx.value(6, row_idx)),
                    'grupo_name': str(idx.value(7, row_idx) or '').strip(),
                    'pedimento': str(idx.value(8, row_idx) or '').strip(),
                    'contenedor': str(idx.value(9, row_idx) or 'SN').strip(),
                    'ref_proveedor': str(idx.value(10, row_idx) or '').strip(),
                })
            except: continue
        return rows

    def _to_float(self, val):
        if val is None: return 0.0
        try: return float(str(val).replace(',', '.'))
        except: return 0.0

    def _parse_tipo(self, val):
        if not val: return 'placa'
        return 'formato' if str(val).lower().strip() == 'formato' else 'placa'

    def _get_data_from_excel_file(self):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            p_code = str(p_info).split('(')[1].split(')')[0].strip() if '(' in str(p_info) else ''
            product = self.env['product.product'].search([
                '|', ('default_code', '=', p_code), ('name', '=', str(p_info).split('(')[0].strip())
            ], limit=1)
            if not product: continue
            
            for r in range(4, sheet.max_row + 1):
                if not sheet.cell(r, 1).value: continue
                rows.append({
                    'product': product,
                    'grosor': self._to_float(sheet.cell(r, 1).value),
                    'alto': self._to_float(sheet.cell(r, 2).value),
                    'ancho': self._to_float(sheet.cell(r, 3).value),
                    'color': str(sheet.cell(r, 4).value or '').strip(),
                    'bloque': str(sheet.cell(r, 5).value or '').strip(),
                    'atado': str(sheet.cell(r, 6).value or '').strip(),
                    'tipo': self._parse_tipo(sheet.cell(r, 7).value),
                    'grupo_name': str(sheet.cell(r, 8).value or '').strip(),
                    'pedimento': str(sheet.cell(r, 9).value or '').strip(),
                    'contenedor': str(sheet.cell(r, 10).value or 'SN').strip(),
                    'ref_proveedor': str(sheet.cell(r, 11).value or '').strip(),
                })
        return rows