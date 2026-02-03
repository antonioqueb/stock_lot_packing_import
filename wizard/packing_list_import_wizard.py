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

    def put(self, col, row, content, source="unknown"):
        if col is not None and row is not None:
            if content in (None, False, ""):
                if (int(col), int(row)) in self._cells:
                    del self._cells[(int(col), int(row))]
            else:
                self._cells[(int(col), int(row))] = str(content)

    def ingest_cells(self, raw_cells):
        if not raw_cells:
            return
        for key, cell_data in raw_cells.items():
            col, row = self._parse_cell_key(key)
            if col is not None and row is not None:
                content = self._extract_content(cell_data)
                if content:
                    self.put(col, row, content, source="snapshot")

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
            return cell_data.get('content') or cell_data.get('value') or cell_data.get('text') or ""
        return cell_data or ""

    def apply_revision_commands(self, commands, target_sheet_id):
        applied = 0
        for cmd in commands:
            if isinstance(cmd, list):
                applied += self.apply_revision_commands(cmd, target_sheet_id)
                continue

            if cmd.get('sheetId') and cmd.get('sheetId') != target_sheet_id:
                continue
            
            cmd_type = cmd.get('type')
            
            if cmd_type == 'UPDATE_CELL':
                col, row = cmd.get('col'), cmd.get('row')
                if col is not None and row is not None:
                    content = self._extract_content(cmd)
                    self.put(col, row, content, source="UPDATE_CELL_REV")
                    applied += 1
            
            elif cmd_type == 'REMOVE_COLUMNS_ROWS':
                if cmd.get('dimension') == 'row':
                    elements = sorted(cmd.get('elements', []), reverse=True)
                    for row_idx in elements:
                        self._shift_rows_up(row_idx)
                    applied += 1
                        
            elif cmd_type in ('DELETE_CONTENT', 'CLEAR_CELL'):
                zones = cmd.get('zones') or cmd.get('target') or []
                for zone in zones:
                    for r in range(zone.get('top', 0), zone.get('bottom', 0) + 1):
                        for c in range(zone.get('left', 0), zone.get('right', 0) + 1):
                            self.put(c, r, "", source="DELETE_REV")
                applied += 1
        return applied

    def _shift_rows_up(self, removed_row):
        new_cells = {}
        for (c, r), val in self._cells.items():
            if r < removed_row:
                new_cells[(c, r)] = val
            elif r > removed_row:
                new_cells[(c, r - 1)] = val
        self._cells = new_cells

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
        _logger.info("=== [PL_IMPORT] INICIO PROCESO DE CARGA ===")
        
        rows = []
        if self.excel_file:
            rows = self._get_data_from_excel_file()
        elif self.spreadsheet_id:
            rows = self._get_data_from_spreadsheet()
        
        _logger.info(f"[PL_IMPORT] Resultado Final: {len(rows)} filas listas para importar.")

        if not rows:
            raise UserError("No se encontraron datos válidos. Verifique las dimensiones o cantidades.")

        # --- LÓGICA DE LIMPIEZA PROFUNDA ---
        _logger.info("[PL_CLEANUP] Borrando datos previos...")
        old_move_lines = self.picking_id.move_line_ids
        old_lots = old_move_lines.mapped('lot_id')

        old_move_lines.write({'qty_done': 0})
        self.env.flush_all()
        if old_lots:
            quants = self.env['stock.quant'].sudo().search([('lot_id', 'in', old_lots.ids)])
            quants.sudo().unlink()

        old_move_lines.unlink()
        for lot in old_lots:
            if self.env['stock.move.line'].search_count([('lot_id', '=', lot.id)]) == 0:
                try:
                    with self.env.cr.savepoint():
                        lot.unlink()
                except Exception as e:
                    _logger.warning(f"[PL_CLEANUP] No se pudo borrar lote {lot.name}: {e}")

        # --- CREACIÓN DE NUEVOS REGISTROS ---
        move_lines_created = 0
        next_prefix = self._get_next_global_prefix()
        containers = {}

        for data in rows:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move: continue

            unit_type = data.get('tipo', 'Placa')
            
            qty_done = 0.0
            final_alto = 0.0
            final_ancho = 0.0

            if unit_type == 'Placa':
                final_alto = data.get('alto', 0.0)
                final_ancho = data.get('ancho', 0.0)
                qty_done = round(final_alto * final_ancho, 3)
            else:
                qty_done = data.get('quantity', 0.0)
                final_alto = 0.0
                final_ancho = 0.0

            if qty_done <= 0: continue

            cont = data['contenedor'] or 'SN'
            if cont not in containers:
                containers[cont] = {'pre': str(next_prefix), 'num': self._get_next_lot_number_for_prefix(str(next_prefix))}
                next_prefix += 1

            l_name = f"{containers[cont]['pre']}-{containers[cont]['num']:02d}"
            
            grupo_ids = []
            if data.get('grupo_name'):
                grupo = self.env['stock.lot.group'].search([('name', '=', data['grupo_name'].strip())], limit=1)
                if not grupo: grupo = self.env['stock.lot.group'].create({'name': data['grupo_name'].strip()})
                grupo_ids = [grupo.id]

            lot_selection_value = str(unit_type).lower()

            lot = self.env['stock.lot'].create({
                'name': l_name, 
                'product_id': product.id, 
                'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'], 
                'x_alto': final_alto, 
                'x_ancho': final_ancho,
                'x_color': data.get('color'), 
                'x_bloque': data['bloque'], 
                'x_numero_placa': data.get('numero_placa'), 
                'x_atado': data['atado'],
                'x_tipo': lot_selection_value,
                'x_grupo': [(6, 0, grupo_ids)], 
                'x_pedimento': data['pedimento'],
                'x_contenedor': cont, 
                'x_referencia_proveedor': data['ref_proveedor'],
            })
            
            self.env['stock.move.line'].create({
                'move_id': move.id, 
                'product_id': product.id, 
                'lot_id': lot.id,
                'qty_done': qty_done, 
                'location_id': self.picking_id.location_id.id, 
                'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id, 
                'x_grosor_temp': data['grosor'], 
                'x_alto_temp': final_alto,
                'x_ancho_temp': final_ancho, 
                'x_color_temp': data.get('color'), 
                'x_tipo_temp': lot_selection_value,
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
        _logger.info(f"=== [PL_IMPORT] PROCESO TERMINADO. Creados {move_lines_created} registros. ===")
        return {
            'type': 'ir.actions.client', 'tag': 'display_notification',
            'params': {
                'title': 'PL Procesado', 'message': f'Se han importado/corregido {move_lines_created} lotes.',
                'type': 'success', 'next': {'type': 'ir.actions.act_window_close'}
            }
        }

    def _get_data_from_spreadsheet(self):
        doc = self.spreadsheet_id
        spreadsheet_json = self._get_current_spreadsheet_state(doc)
        if not spreadsheet_json or not spreadsheet_json.get('sheets'):
            return []

        all_rows = []
        for sheet in spreadsheet_json['sheets']:
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            
            product = self._identify_product_from_sheet(idx)
            if product:
                sheet_rows = self._extract_rows_from_index(idx, product)
                all_rows.extend(sheet_rows)
        return all_rows

    def _get_current_spreadsheet_state(self, doc):
        if doc.spreadsheet_snapshot:
            try:
                data = doc.spreadsheet_snapshot
                parsed = json.loads(data.decode('utf-8') if isinstance(data, bytes) else data)
                if parsed and parsed.get('sheets'):
                    return self._apply_pending_revisions(doc, parsed)
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error leyendo snapshot: {e}")
        
        try:
            if hasattr(doc, '_get_spreadsheet_serialized_snapshot'):
                snapshot_data = doc._get_spreadsheet_serialized_snapshot()
                if snapshot_data:
                    parsed = json.loads(snapshot_data) if isinstance(snapshot_data, str) else snapshot_data
                    if parsed and parsed.get('sheets'):
                        return self._apply_pending_revisions(doc, parsed)
        except Exception as e:
            _logger.warning(f"[PL_IMPORT] Error en _get_spreadsheet_serialized_snapshot: {e}")
        
        _logger.info("[PL_IMPORT] Fallback: spreadsheet_data + todas las revisiones")
        return self._load_spreadsheet_with_all_revisions(doc)

    def _apply_pending_revisions(self, doc, spreadsheet_json):
        snapshot_revision_id = spreadsheet_json.get('revisionId', '')
        if not snapshot_revision_id:
            return spreadsheet_json
        
        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'), 
            ('res_id', '=', doc.id)
        ], order='id asc')
        
        start_applying = False
        all_cmds = []
        
        for rev in revisions:
            rev_data = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
            if not start_applying:
                rev_id = rev_data.get('id') if isinstance(rev_data, dict) else None
                if rev_id == snapshot_revision_id:
                    start_applying = True
                continue
            if isinstance(rev_data, dict) and rev_data.get('type') == 'SNAPSHOT_CREATED':
                continue
            if isinstance(rev_data, dict) and 'commands' in rev_data:
                all_cmds.extend(rev_data['commands'])
            elif isinstance(rev_data, list):
                all_cmds.extend(rev_data)
        
        if not all_cmds:
            return spreadsheet_json
        
        for sheet in spreadsheet_json.get('sheets', []):
            sheet_id = sheet.get('id')
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            idx.apply_revision_commands(all_cmds, sheet_id)
            sheet['cells'] = {f"{self._col_to_letter(c)}{r+1}": {'content': v} 
                             for (c, r), v in idx._cells.items()}
        
        return spreadsheet_json

    def _load_spreadsheet_with_all_revisions(self, doc):
        spreadsheet_json = self._load_spreadsheet_json(doc)
        if not spreadsheet_json:
            return None
        
        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'), 
            ('res_id', '=', doc.id)
        ], order='id asc')
        
        all_cmds = []
        for rev in revisions:
            rev_data = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
            if isinstance(rev_data, dict) and rev_data.get('type') == 'SNAPSHOT_CREATED':
                continue
            if isinstance(rev_data, dict) and 'commands' in rev_data:
                all_cmds.extend(rev_data['commands'])
            elif isinstance(rev_data, list):
                all_cmds.extend(rev_data)
        
        for sheet in spreadsheet_json.get('sheets', []):
            sheet_id = sheet.get('id')
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            idx.apply_revision_commands(all_cmds, sheet.get('id'))
            sheet['cells'] = {f"{self._col_to_letter(c)}{r+1}": {'content': v} 
                             for (c, r), v in idx._cells.items()}
        
        return spreadsheet_json

    def _col_to_letter(self, col):
        result = ""
        col += 1
        while col:
            col, remainder = divmod(col - 1, 26)
            result = chr(65 + remainder) + result
        return result

    def _identify_product_from_sheet(self, idx):
        p_info = None
        for r in range(3):
            label = str(idx.value(0, r) or "").upper()
            if "PRODUCTO:" in label:
                p_info = idx.value(1, r)
                break
        if not p_info: p_info = idx.value(1, 0)
        
        if not p_info: return None
        p_name = str(p_info).split('(')[0].strip()
        return self.env['product.product'].search(['|', ('name', '=', p_name), ('default_code', '=', p_name)], limit=1)

    def _extract_rows_from_index(self, idx, product):
        rows = []
        unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
        
        # --- DEFINICIÓN DINÁMICA DE ÍNDICES DE COLUMNA ---
        # Si es PLACA, existe la columna 'Ancho' en C (idx 2).
        # Si NO es Placa, esa columna no existe, por lo que 'Peso' y las siguientes se recorren a la izquierda.
        
        if unit_type == 'Placa':
            # Estructura: A=Grosor, B=Alto, C=Ancho, D=Peso, E=Notas, F=Bloque, G=Placa...
            idx_peso = 3
            idx_notas = 4
            idx_bloque = 5
            idx_placa = 6
            idx_atado = 7
            idx_grupo = 8
            idx_pedimento = 9
            idx_contenedor = 10
            idx_ref = 11
        else:
            # Estructura: A=Grosor, B=Cantidad, C=Peso, D=Notas, E=Bloque, F=Placa...
            idx_peso = 2
            idx_notas = 3
            idx_bloque = 4
            idx_placa = 5
            idx_atado = 6
            idx_grupo = 7
            idx_pedimento = 8
            idx_contenedor = 9
            idx_ref = 10

        for r in range(3, 300):
            # Leemos las columnas B y C sin prejuicios para la validación
            val_b = self._to_float(idx.value(1, r)) 
            val_c = self._to_float(idx.value(2, r)) 
            
            es_valido = False
            
            if unit_type == 'Placa':
                # Placa exige Alto (B) y Ancho (C)
                if val_b > 0 and val_c > 0: es_valido = True
            else:
                # 'Pieza' y 'Formato' exigen solo Cantidad (B)
                if val_b > 0: es_valido = True

            if es_valido:
                rows.append({
                    'product': product, 
                    'grosor': str(idx.value(0, r) or '').strip(), # A siempre es Grosor
                    
                    'alto': val_b if unit_type == 'Placa' else 0.0,
                    'ancho': val_c if unit_type == 'Placa' else 0.0,
                    'quantity': val_b if unit_type != 'Placa' else 0.0,
                    
                    # --- USO DE ÍNDICES DINÁMICOS ---
                    'color': str(idx.value(idx_notas, r) or '').strip(), 
                    'bloque': str(idx.value(idx_bloque, r) or '').strip(), 
                    'numero_placa': str(idx.value(idx_placa, r) or '').strip(), 
                    'atado': str(idx.value(idx_atado, r) or '').strip(), 
                    
                    'tipo': unit_type, 
                    
                    'grupo_name': str(idx.value(idx_grupo, r) or '').strip(), 
                    'pedimento': str(idx.value(idx_pedimento, r) or '').strip(),  
                    'contenedor': str(idx.value(idx_contenedor, r) or 'SN').strip(), 
                    'ref_proveedor': str(idx.value(idx_ref, r) or '').strip(), 
                })
        return rows

    def _to_float(self, val):
        if not val: return 0.0
        try: return float(str(val).replace(',', '.').strip())
        except: return 0.0

    def _get_next_global_prefix(self):
        self.env.cr.execute("""SELECT CAST(SUBSTRING(name FROM '^([0-9]+)-') AS INTEGER) as prefix_num FROM stock_lot WHERE name ~ '^[0-9]+-[0-9]+$' AND company_id = %s ORDER BY prefix_num DESC LIMIT 1""", (self.picking_id.company_id.id,))
        res = self.env.cr.fetchone()
        return (res[0] + 1) if res and res[0] else 1

    def _get_next_lot_number_for_prefix(self, prefix):
        self.env.cr.execute("""SELECT name FROM stock_lot WHERE name LIKE %s AND company_id = %s ORDER BY CAST(SUBSTRING(name FROM '-([0-9]+)$') AS INTEGER) DESC LIMIT 1""", (f'{prefix}-%', self.picking_id.company_id.id))
        res = self.env.cr.fetchone()
        return int(res[0].split('-')[1]) + 1 if res else 1

    def _load_spreadsheet_json(self, doc):
        if doc.spreadsheet_data:
            try:
                data = doc.spreadsheet_data
                return json.loads(data.decode('utf-8') if isinstance(data, bytes) else data)
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
            
            unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
            
            # Definición dinámica de columnas Excel (Base 1)
            if unit_type == 'Placa':
                # A=1, B=2, C=3, D=4(Peso), E=5(Notas), F=6(Bloque), G=7(Placa)...
                col_notas = 5
                col_bloque = 6
                col_placa = 7
                col_atado = 8
                col_grupo = 10 # Salta H e I en tu ejemplo original? Ajustar según lógica de índices
                # Re-mapeo estándar según tu lógica de Spreadsheet:
                # Spreadsheet: I(8) -> Excel: 9
                col_grupo = 9
                col_pedimento = 10
                col_contenedor = 11
                col_ref = 12
            else:
                # Recorrido a la izquierda
                col_notas = 4
                col_bloque = 5
                col_placa = 6
                col_atado = 7
                col_grupo = 8
                col_pedimento = 9
                col_contenedor = 10
                col_ref = 11

            for r in range(4, sheet.max_row + 1):
                val_b = self._to_float(sheet.cell(r, 2).value) # Col B
                val_c = self._to_float(sheet.cell(r, 3).value) # Col C
                
                es_valido = False
                if unit_type == 'Placa':
                    if val_b > 0 and val_c > 0: es_valido = True
                else:
                    if val_b > 0: es_valido = True

                if es_valido:
                    rows.append({
                        'product': product, 
                        'grosor': str(sheet.cell(r, 1).value or '').strip(),
                        
                        'alto': val_b if unit_type == 'Placa' else 0.0,
                        'ancho': val_c if unit_type == 'Placa' else 0.0,
                        'quantity': val_b if unit_type != 'Placa' else 0.0,
                        
                        # Indices dinámicos
                        'color': str(sheet.cell(r, col_notas).value or '').strip(),
                        'bloque': str(sheet.cell(r, col_bloque).value or '').strip(),
                        'numero_placa': str(sheet.cell(r, col_placa).value or '').strip(),
                        'atado': str(sheet.cell(r, col_atado).value or '').strip(),
                        
                        'tipo': unit_type,
                        
                        'grupo_name': str(sheet.cell(r, col_grupo).value or '').strip(), 
                        'pedimento': str(sheet.cell(r, col_pedimento).value or '').strip(),
                        'contenedor': str(sheet.cell(r, col_contenedor).value or 'SN').strip(),
                        'ref_proveedor': str(sheet.cell(r, col_ref).value or '').strip(),
                    })
        return rows