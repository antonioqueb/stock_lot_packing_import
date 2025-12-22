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
    
    def debug_dump(self, max_rows=25):
        """Imprime las celdas para debug"""
        for (c, r), v in sorted(self._cells.items()):
            if r < max_rows:
                _logger.info(f"  Celda ({c},{r}): {v}")


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
            raise UserError(
                "No se encontraron datos.\n\n"
                "Posibles causas:\n"
                "• No llenó las filas a partir de la fila 4\n"
                "• El spreadsheet no se guardó (ciérrelo y vuelva a intentar)\n"
                "• La columna A (Grosor) está vacía en todas las filas"
            )
        
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
            
            # Crear el lote con todos los campos
            lot = self.env['stock.lot'].create({
                'name': l_name,
                'product_id': product.id,
                'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'],
                'x_alto': data['alto'],
                'x_ancho': data['ancho'],
                'x_bloque': data['bloque'],
                'x_atado': data['atado'],
                'x_tipo': data['tipo'],
                'x_pedimento': data['pedimento'],
                'x_contenedor': cont,
                'x_referencia_proveedor': data['ref_proveedor'],
            })
            
            # Crear el move line CON los campos temporales para visualización
            self.env['stock.move.line'].create({
                'move_id': move.id,
                'product_id': product.id,
                'lot_id': lot.id,
                'qty_done': data['alto'] * data['ancho'] or 1.0,
                'location_id': self.picking_id.location_id.id,
                'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
                # === CAMPOS TEMPORALES PARA VISUALIZACIÓN EN VISTA ===
                'x_grosor_temp': data['grosor'],
                'x_alto_temp': data['alto'],
                'x_ancho_temp': data['ancho'],
                'x_tipo_temp': data['tipo'],
                'x_bloque_temp': data['bloque'],
                'x_atado_temp': data['atado'],
                'x_pedimento_temp': data['pedimento'],
                'x_contenedor_temp': cont,
                'x_referencia_proveedor_temp': data['ref_proveedor'],
            })
            
            containers[cont]['num'] += 1
            move_lines_created += 1
        
        self.picking_id.write({'packing_list_imported': True})
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Éxito',
                'message': f'Importados {move_lines_created} lotes.',
                'type': 'success',
                'next': {'type': 'ir.actions.act_window_close'}
            }
        }

    def _get_data_from_spreadsheet(self):
        """Extrae datos del spreadsheet nativo de Odoo 19"""
        doc = self.spreadsheet_id
        _logger.info(f"[PL_IMPORT] Documento ID: {doc.id}")
        
        # PASO 1: Cargar JSON base desde attachment
        spreadsheet_json = self._load_spreadsheet_json(doc)
        if not spreadsheet_json:
            _logger.warning("[PL_IMPORT] No se pudo cargar el JSON del spreadsheet")
            return []
        
        sheets = spreadsheet_json.get('sheets', [])
        if not sheets:
            _logger.warning("[PL_IMPORT] El spreadsheet no tiene hojas")
            return []
        
        first_sheet = sheets[0]
        cells_data = first_sheet.get('cells', {})
        _logger.info(f"[PL_IMPORT] Hoja: {first_sheet.get('name')}, Celdas base: {len(cells_data)}")
        
        # PASO 2: Indexar celdas base
        idx = _PLCellsIndex()
        idx.ingest_cells(cells_data)
        
        # PASO 3: Aplicar TODAS las revisiones
        self._apply_all_revisions(doc, idx)
        
        # Debug
        _logger.info("[PL_IMPORT] Contenido final del índice:")
        idx.debug_dump(max_rows=25)
        
        # PASO 4: Extraer filas
        return self._extract_rows_from_index(idx)

    def _load_spreadsheet_json(self, doc):
        """Carga el JSON del spreadsheet"""
        # Desde attachment_id.datas
        if doc.attachment_id and doc.attachment_id.datas:
            try:
                raw_bytes = base64.b64decode(doc.attachment_id.datas)
                json_data = json.loads(raw_bytes.decode('utf-8'))
                _logger.info(f"[PL_IMPORT] JSON cargado desde attachment ({len(raw_bytes)} bytes)")
                return json_data
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error leyendo attachment: {e}")
        
        # Fallback: spreadsheet_data
        if doc.spreadsheet_data:
            try:
                raw = doc.spreadsheet_data
                if isinstance(raw, bytes):
                    raw = raw.decode('utf-8')
                return json.loads(raw)
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error leyendo spreadsheet_data: {e}")
        
        return None

    def _apply_all_revisions(self, doc, idx):
        """
        Aplica TODAS las revisiones del documento.
        
        ESTRUCTURA ODOO 19:
        - commands es un STRING JSON con formato:
          {"type": "REMOTE_REVISION", "version": 1, "commands": [{...}, {...}]}
        - Los UPDATE_CELL reales están en el array 'commands' interno
        
        IMPORTANTE: Las revisiones tienen active=False después de consolidarse,
        por eso usamos with_context(active_test=False)
        """
        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id)
        ], order='id asc')
        
        _logger.info(f"[PL_IMPORT] Total revisiones encontradas: {len(revisions)}")
        
        total_cells_updated = 0
        
        for rev in revisions:
            try:
                # Parsear el JSON del campo commands
                raw_commands = rev.commands
                if not raw_commands:
                    continue
                
                parsed = json.loads(raw_commands) if isinstance(raw_commands, str) else raw_commands
                revision_type = parsed.get('type', '')
                _logger.info(f"[PL_IMPORT] Revisión {rev.id}: tipo={revision_type}")
                
                # Solo procesar REMOTE_REVISION que contienen comandos de celdas
                if revision_type == 'REMOTE_REVISION':
                    # Los comandos reales están en parsed['commands']
                    actual_commands = parsed.get('commands', [])
                    if actual_commands and isinstance(actual_commands, list):
                        applied = idx.apply_revision_commands(actual_commands)
                        total_cells_updated += applied
                        _logger.info(f"[PL_IMPORT]   -> Aplicados {applied} UPDATE_CELL")
                
            except json.JSONDecodeError as e:
                _logger.warning(f"[PL_IMPORT] Error JSON en revisión {rev.id}: {e}")
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error procesando revisión {rev.id}: {e}")
        
        _logger.info(f"[PL_IMPORT] Total celdas actualizadas desde revisiones: {total_cells_updated}")

    def _extract_rows_from_index(self, idx):
        """Extrae las filas de datos del índice de celdas"""
        rows = []
        prod = self.picking_id.move_ids.mapped('product_id')[:1]
        
        if not prod:
            _logger.warning("[PL_IMPORT] No hay producto en los movimientos")
            return []
        
        # Filas 4 a 103 (índices 3 a 102)
        for row_idx in range(3, 103):
            grosor_val = idx.value(0, row_idx)  # Columna A = 0
            if not grosor_val:
                continue
            
            _logger.info(f"[PL_IMPORT] Fila {row_idx + 1}: G={grosor_val}, A={idx.value(1, row_idx)}, An={idx.value(2, row_idx)}")
            
            try:
                row_data = {
                    'product': prod,
                    'grosor': self._to_float(grosor_val),
                    'alto': self._to_float(idx.value(1, row_idx)),
                    'ancho': self._to_float(idx.value(2, row_idx)),
                    'bloque': str(idx.value(3, row_idx) or '').strip(),
                    'atado': str(idx.value(4, row_idx) or '').strip(),
                    'tipo': self._parse_tipo(idx.value(5, row_idx)),
                    'pedimento': str(idx.value(6, row_idx) or '').strip(),
                    'contenedor': str(idx.value(7, row_idx) or 'SN').strip(),
                    'ref_proveedor': str(idx.value(8, row_idx) or '').strip(),
                }
                rows.append(row_data)
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error en fila {row_idx + 1}: {e}")
                continue
        
        _logger.info(f"[PL_IMPORT] Total filas extraídas: {len(rows)}")
        return rows

    def _to_float(self, val):
        """Convierte un valor a float de forma segura"""
        if val is None:
            return 0.0
        try:
            return float(str(val).replace(',', '.'))
        except (ValueError, TypeError):
            return 0.0

    def _parse_tipo(self, val):
        """Parsea el campo tipo"""
        if not val:
            return 'placa'
        return 'formato' if str(val).lower().strip() == 'formato' else 'placa'

    def _get_data_from_excel_file(self):
        """Extrae datos desde archivo Excel"""
        from openpyxl import load_workbook
        
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            p_code = str(p_info).split('(')[1].split(')')[0].strip() if '(' in str(p_info) else ''
            product = self.env['product.product'].search([
                '|',
                ('default_code', '=', p_code),
                ('name', '=', str(p_info).split('(')[0].strip())
            ], limit=1)
            
            if not product:
                continue
            
            for r in range(4, sheet.max_row + 1):
                if not sheet.cell(r, 1).value:
                    continue
                rows.append({
                    'product': product,
                    'grosor': float(sheet.cell(r, 1).value or 0),
                    'alto': float(sheet.cell(r, 2).value or 0),
                    'ancho': float(sheet.cell(r, 3).value or 0),
                    'bloque': str(sheet.cell(r, 4).value or ''),
                    'atado': str(sheet.cell(r, 5).value or ''),
                    'tipo': 'formato' if str(sheet.cell(r, 6).value or '').lower() == 'formato' else 'placa',
                    'pedimento': str(sheet.cell(r, 7).value or ''),
                    'contenedor': str(sheet.cell(r, 8).value or 'SN').strip(),
                    'ref_proveedor': str(sheet.cell(r, 9).value or ''),
                })
        
        return rows