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
    """ Clase para normalizar el acceso a celdas de Odoo Spreadsheet """
    def __init__(self, raw_cells):
        self._cells = {} 
        self._ingest(raw_cells)

    def _put(self, c, r, cell):
        if c is not None and r is not None:
            if not isinstance(cell, dict): cell = {"content": cell}
            self._cells[(int(c), int(r))] = cell

    def _ingest(self, raw_cells):
        if not raw_cells or not isinstance(raw_cells, dict): return
        for k, v in raw_cells.items():
            # Caso "A1"
            if isinstance(k, str) and k[0].isalpha():
                m = re.match(r"^([A-Z]+)(\d+)$", k.upper())
                if m:
                    col_str, row_str = m.groups()
                    c = 0
                    for char in col_str: c = c * 26 + (ord(char) - ord('A') + 1)
                    self._put(c - 1, int(row_str) - 1, v)
            # Caso "0,3"
            elif isinstance(k, str) and ',' in k:
                parts = k.split(',')
                self._put(parts[0], parts[1], v)
            # Caso anidado { "3": { "0": {...} } }
            elif isinstance(v, dict):
                for ck, cv in v.items():
                    try: self._put(int(ck), int(k), cv)
                    except: pass

    def value(self, c, r):
        cell = self._cells.get((int(c), int(r)))
        if not cell: return None
        return cell.get('content') or cell.get('value') or cell.get('text')

class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List'

    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    spreadsheet_id = fields.Many2one('documents.document', related='picking_id.spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=False, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')

    def _get_next_global_prefix(self):
        self.env.cr.execute("""
            SELECT CAST(SUBSTRING(sl.name FROM '^([0-9]+)-') AS INTEGER) as prefix_num
            FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name ~ '^[0-9]+-[0-9]+$' AND sp.state = 'done' AND sp.company_id = %s
            ORDER BY prefix_num DESC LIMIT 1
        """, (self.picking_id.company_id.id,))
        res = self.env.cr.fetchone()
        return (res[0] + 1) if res and res[0] else 1

    def _get_next_lot_number_for_prefix(self, prefix):
        self.env.cr.execute("""
            SELECT sl.name FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name LIKE %s AND sp.state = 'done' AND sp.company_id = %s
            ORDER BY CAST(SUBSTRING(sl.name FROM '-([0-9]+)$') AS INTEGER) DESC LIMIT 1
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
            raise UserError("No se encontraron datos. Verifique que llenó las filas a partir de la 4 y que Odoo guardó los cambios.")

        self.picking_id.move_line_ids.unlink()
        move_lines_created = 0
        next_prefix = self._get_next_global_prefix()
        containers = {}

        for data in rows:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move: continue

            cont = data['contenedor'] or 'SN'
            if cont not in containers:
                containers[cont] = {'pre': str(next_prefix), 'num': self._get_next_lot_number_for_prefix(str(next_prefix))}
                next_prefix += 1

            l_name = f"{containers[cont]['pre']}-{containers[cont]['num']:02d}"
            lot = self.env['stock.lot'].create({
                'name': l_name, 'product_id': product.id, 'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'], 'x_alto': data['alto'], 'x_ancho': data['ancho'],
                'x_bloque': data['bloque'], 'x_atado': data['atado'], 'x_tipo': data['tipo'],
                'x_pedimento': data['pedimento'], 'x_contenedor': cont, 'x_referencia_proveedor': data['ref_proveedor'],
            })
            
            self.env['stock.move_line'].create({
                'move_id': move.id, 'product_id': product.id, 'lot_id': lot.id, 'qty_done': data['alto'] * data['ancho'] or 1.0,
                'location_id': self.picking_id.location_id.id, 'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
            })
            containers[cont]['num'] += 1
            move_lines_created += 1

        self.picking_id.write({'packing_list_imported': True})
        return {'type': 'ir.actions.client', 'tag': 'display_notification', 'params': {
            'title': 'Éxito', 'message': f'Importados {move_lines_created} lotes.',
            'type': 'success', 'next': {'type': 'ir.actions.act_window_close'}
        }}

    def _get_data_from_spreadsheet(self):
        doc = self.spreadsheet_id
        # 1. Obtener base
        raw = doc.spreadsheet_data
        if isinstance(raw, bytes): raw = raw.decode('utf-8')
        data_json = json.loads(raw or '{}')
        sheets = data_json.get('sheets', [])
        idx = _PLCellsIndex(sheets[0].get('cells') if sheets else {})

        # 2. BUSCAR REVISIONES (CLAVE DEL ÉXITO EN ODOO 19)
        # Buscamos revisiones que apunten al Picking (donde se originan los cambios)
        # y al Documento (donde se guardan)
        rev_domain = ['|', 
            '&', ('res_model', '=', 'stock.picking'), ('res_id', '=', self.picking_id.id),
            '&', ('res_model', '=', 'documents.document'), ('res_id', '=', doc.id)
        ]
        revisions = self.env['spreadsheet.revision'].sudo().search(rev_domain, order='id asc')
        _logger.info(f"[PL_IMPORT] Revisiones encontradas en Picking/Documento: {len(revisions)}")

        for rev in revisions:
            try:
                # Odoo 19 puede tener 'commands' como string o json
                cmds = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
                for cmd in cmds:
                    if cmd.get('type') in ('UPDATE_CELL', 'SET_CELL_CONTENT'):
                        content = cmd.get('content') or cmd.get('cell', {}).get('content')
                        idx._put(cmd.get('col'), cmd.get('row'), content)
            except: continue

        # 3. Extraer Filas
        rows = []
        prod = self.picking_id.move_ids.mapped('product_id')[:1]
        for r in range(3, 100): # r=3 es fila 4
            g = idx.value(0, r)
            if not g: continue # Si no hay grosor, saltamos fila
            
            _logger.info(f"[PL_IMPORT] Leyendo Fila {r+1}: G={g}, A={idx.value(1,r)}, An={idx.value(2,r)}")
            
            try:
                rows.append({
                    'product': prod,
                    'grosor': float(str(g).replace(',', '.')),
                    'alto': float(str(idx.value(1, r) or 0).replace(',', '.')),
                    'ancho': float(str(idx.value(2, r) or 0).replace(',', '.')),
                    'bloque': str(idx.value(3, r) or '').strip(),
                    'atado': str(idx.value(4, r) or '').strip(),
                    'tipo': 'formato' if str(idx.value(5, r) or '').lower() == 'formato' else 'placa',
                    'pedimento': str(idx.value(6, r) or '').strip(),
                    'contenedor': str(idx.value(7, r) or 'SN').strip(),
                    'ref_proveedor': str(idx.value(8, r) or '').strip(),
                })
            except: continue
        return rows

    def _get_data_from_excel_file(self):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            p_code = str(p_info).split('(')[1].split(')')[0].strip() if '(' in str(p_info) else ''
            product = self.env['product.product'].search(['|', ('default_code', '=', p_code), ('name', '=', str(p_info).split('(')[0].strip())], limit=1)
            if not product: continue
            for r in range(4, sheet.max_row + 1):
                if not sheet.cell(r, 1).value: continue
                rows.append({
                    'product': product, 'grosor': float(sheet.cell(r, 1).value or 0),
                    'alto': float(sheet.cell(r, 2).value or 0), 'ancho': float(sheet.cell(r, 3).value or 0),
                    'bloque': str(sheet.cell(r, 4).value or ''), 'atado': str(sheet.cell(r, 5).value or ''),
                    'tipo': 'formato' if str(sheet.cell(r, 6).value or '').lower() == 'formato' else 'placa',
                    'pedimento': str(sheet.cell(r, 7).value or ''), 'contenedor': str(sheet.cell(r, 8).value or 'SN').strip(),
                    'ref_proveedor': str(sheet.cell(r, 9).value or ''),
                })
        return rows