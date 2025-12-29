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
            # Prioridad al content de la edición actual
            return cell_data.get('content') or cell_data.get('value') or cell_data.get('text')
        return cell_data

    def apply_revision_commands(self, commands, target_sheet_id):
        applied = 0
        for cmd in commands:
            # En Odoo 19, las revisiones pueden no traer sheetId si es la activa
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
        _logger.info("=== [PL_IMPORT] INICIO PROCESO ===")
        
        rows = []
        if self.excel_file:
            rows = self._get_data_from_excel_file()
        elif self.spreadsheet_id:
            rows = self._get_data_from_spreadsheet()
        
        if not rows:
            _logger.warning("[PL_IMPORT] No se extrajeron filas de ninguna fuente.")
            raise UserError("No se encontraron datos. Asegúrese de haber llenado las celdas y que el producto en B1 sea correcto.")

        # -------------------------------------------------------------------------
        # LÓGICA DE LIMPIEZA (Basada en el comportamiento del Worksheet)
        # -------------------------------------------------------------------------
        # 1. Identificar líneas y lotes actuales
        old_move_lines = self.picking_id.move_line_ids
        old_lots = old_move_lines.mapped('lot_id')

        # 2. Poner qty_done = 0 para liberar los Quants
        old_move_lines.write({'qty_done': 0})
        self.env.flush_all() # Asegurar que Odoo procese el cambio a 0

        # 3. Eliminar los quants asociados a los lotes viejos
        if old_lots:
            quants = self.env['stock.quant'].sudo().search([('lot_id', 'in', old_lots.ids)])
            if quants:
                quants.sudo().write({'quantity': 0, 'reserved_quantity': 0})
                quants.sudo().unlink()

        # 4. Eliminar las líneas de movimiento
        old_move_lines.unlink()

        # 5. Eliminar los lotes antiguos (si no tienen otras operaciones)
        for lot in old_lots:
            other_ops = self.env['stock.move.line'].search_count([('lot_id', '=', lot.id)])
            if other_ops == 0:
                try:
                    with self.env.cr.savepoint():
                        lot.unlink()
                except:
                    _logger.info(f"Lote {lot.name} no se pudo borrar, se mantiene.")
        # -------------------------------------------------------------------------

        move_lines_created = 0
        next_prefix = self._get_next_global_prefix()
        containers = {}

        for data in rows:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move:
                _logger.warning(f"[PL_IMPORT] Producto {product.name} no está en la orden. Saltando.")
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
        _logger.info(f"=== [PL_IMPORT] FIN. Creados {move_lines_created} lotes. ===")
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
            _logger.error("[PL_IMPORT] El Spreadsheet no tiene contenido válido.")
            return []
        
        # Obtener todas las revisiones (cambios del usuario)
        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id)
        ], order='id asc')
        _logger.info(f"[PL_IMPORT] Procesando {len(revisions)} revisiones de Spreadsheet.")

        all_rows = []
        for sheet in spreadsheet_json['sheets']:
            sheet_id = sheet.get('id')
            sheet_name = sheet.get('name')
            _logger.info(f"[PL_IMPORT] Analizando hoja: {sheet_name} (ID: {sheet_id})")
            
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            
            # Aplicar cambios manuales del usuario
            for rev in revisions:
                try:
                    cmds = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
                    if isinstance(cmds, dict) and cmds.get('type') == 'REMOTE_REVISION':
                        idx.apply_revision_commands(cmds.get('commands', []), sheet_id)
                except: continue
            
            # Identificar producto
            product = self._identify_product_from_sheet(idx)
            if not product:
                _logger.warning(f"[PL_IMPORT] No se pudo identificar producto en hoja {sheet_name}. Celda B1: {idx.value(1,0)}")
                continue

            _logger.info(f"[PL_IMPORT] Producto identificado: {product.display_name}")
            
            # Extraer filas
            sheet_rows = self._extract_rows_from_index(idx, product)
            _logger.info(f"[PL_IMPORT] Extraídas {len(sheet_rows)} filas de la hoja {sheet_name}")
            all_rows.extend(sheet_rows)
            
        return all_rows

    def _identify_product_from_sheet(self, idx):
        p_info = idx.value(1, 0) # Celda B1
        if not p_info: return None
        
        info_str = str(p_info).strip()
        _logger.info(f"[PL_IMPORT] Buscando producto con info de B1: '{info_str}'")
        
        # Intentar extraer código entre paréntesis
        p_code = ""
        if '(' in info_str and ')' in info_str:
            p_code = info_str.split('(')[1].split(')')[0].strip()
        
        # Intentar extraer nombre (lo que está antes del paréntesis)
        p_name = info_str.split('(')[0].strip()
        
        domain = ['|', ('name', '=', p_name), ('default_code', '=', p_name)]
        if p_code:
            domain = ['|', ('default_code', '=', p_code)] + domain
            
        return self.env['product.product'].search(domain, limit=1)

    def _extract_rows_from_index(self, idx, product):
        rows = []
        # Odoo 19 Spreadsheet: filas son base 0. Row 4 es índice 3.
        for r in range(3, 100):
            grosor_raw = idx.value(0, r)
            alto_raw = idx.value(1, r)
            ancho_raw = idx.value(2, r)

            # Si las 3 celdas principales están vacías, saltar
            if not grosor_raw and not alto_raw and not ancho_raw:
                continue
            
            # Validación adicional: Si alto o ancho es 0, significa que la fila fue borrada 
            # o está vacía y no debe ser un lote
            if self._to_float(alto_raw) == 0.0 or self._to_float(ancho_raw) == 0.0:
                continue

            try:
                rows.append({
                    'product': product,
                    'grosor': self._to_float(grosor_raw),
                    'alto': self._to_float(alto_raw),
                    'ancho': self._to_float(ancho_raw),
                    'color': str(idx.value(3, r) or '').strip(),
                    'bloque': str(idx.value(4, r) or '').strip(),
                    'atado': str(idx.value(5, r) or '').strip(),
                    'tipo': self._parse_tipo(idx.value(6, r)),
                    'grupo_name': str(idx.value(7, r) or '').strip(),
                    'pedimento': str(idx.value(8, r) or '').strip(),
                    'contenedor': str(idx.value(9, r) or 'SN').strip(),
                    'ref_proveedor': str(idx.value(10, r) or '').strip(),
                })
            except Exception as e:
                _logger.error(f"[PL_IMPORT] Error en fila {r+1}: {e}")
                continue
        return rows

    def _to_float(self, val):
        if val is None or val == '': return 0.0
        try:
            clean_val = str(val).replace(',', '.')
            return float(clean_val)
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
        if doc.attachment_id and doc.attachment_id.datas:
            try:
                raw_bytes = base64.b64decode(doc.attachment_id.datas)
                return json.loads(raw_bytes.decode('utf-8'))
            except: pass
        return None

    def _get_data_from_excel_file(self):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info: continue
            
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