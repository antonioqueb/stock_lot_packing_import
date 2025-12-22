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
        # Formato A1 (ej: "A4", "B10", "AA1")
        if isinstance(key, str) and key and key[0].isalpha():
            match = re.match(r'^([A-Z]+)(\d+)$', key.upper())
            if match:
                col_str, row_str = match.groups()
                col = 0
                for char in col_str:
                    col = col * 26 + (ord(char) - ord('A') + 1)
                return col - 1, int(row_str) - 1
        
        # Formato "col,row" (ej: "0,3")
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
            return
        
        for cmd in commands:
            cmd_type = cmd.get('type', '')
            if cmd_type in ('UPDATE_CELL', 'SET_CELL_CONTENT', 'UPDATE_CELL_CONTENT'):
                col = cmd.get('col')
                row = cmd.get('row')
                content = cmd.get('content')
                if content is None:
                    cell = cmd.get('cell', {})
                    content = cell.get('content') if isinstance(cell, dict) else None
                if col is not None and row is not None:
                    self.put(col, row, content)

    def value(self, col, row):
        """Obtiene el valor de una celda"""
        return self._cells.get((int(col), int(row)))

    def debug_dump(self, max_rows=20):
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
            
            self.env['stock.move.line'].create({
                'move_id': move.id,
                'product_id': product.id,
                'lot_id': lot.id,
                'qty_done': data['alto'] * data['ancho'] or 1.0,
                'location_id': self.picking_id.location_id.id,
                'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
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
        """
        Extrae datos del spreadsheet nativo de Odoo.
        
        ARQUITECTURA ODOO 17-19:
        - Los datos están en attachment_id.datas (Base64 → JSON)
        - Las ediciones recientes pueden estar en spreadsheet.revision
        """
        doc = self.spreadsheet_id
        _logger.info(f"[PL_IMPORT] Documento ID: {doc.id}, Attachment ID: {doc.attachment_id.id if doc.attachment_id else 'None'}")
        
        # === PASO 1: Obtener JSON base del ATTACHMENT (no de spreadsheet_data) ===
        spreadsheet_json = self._load_spreadsheet_json(doc)
        if not spreadsheet_json:
            _logger.warning("[PL_IMPORT] No se pudo cargar el JSON del spreadsheet")
            return []
        
        sheets = spreadsheet_json.get('sheets', [])
        if not sheets:
            _logger.warning("[PL_IMPORT] El spreadsheet no tiene hojas")
            return []
        
        # Usar la primera hoja
        first_sheet = sheets[0]
        cells_data = first_sheet.get('cells', {})
        
        _logger.info(f"[PL_IMPORT] Hoja: {first_sheet.get('name')}, Celdas encontradas: {len(cells_data)}")
        
        # === PASO 2: Indexar celdas base ===
        idx = _PLCellsIndex()
        idx.ingest_cells(cells_data)
        
        # === PASO 3: Aplicar revisiones pendientes (si existen) ===
        self._apply_pending_revisions(doc, idx)
        
        # Debug: mostrar qué hay en el índice
        _logger.info("[PL_IMPORT] Contenido del índice de celdas:")
        idx.debug_dump(max_rows=15)
        
        # === PASO 4: Extraer filas de datos ===
        return self._extract_rows_from_index(idx)

    def _load_spreadsheet_json(self, doc):
        """Carga el JSON del spreadsheet desde el attachment"""
        json_data = None
        
        # MÉTODO 1: Desde attachment_id.datas (ubicación correcta en Odoo 17-19)
        if doc.attachment_id and doc.attachment_id.datas:
            try:
                raw_bytes = base64.b64decode(doc.attachment_id.datas)
                json_data = json.loads(raw_bytes.decode('utf-8'))
                _logger.info(f"[PL_IMPORT] JSON cargado desde attachment_id.datas ({len(raw_bytes)} bytes)")
                return json_data
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error leyendo attachment: {e}")
        
        # MÉTODO 2: Desde raw (algunos casos de Odoo 18+)
        if hasattr(doc, 'raw') and doc.raw:
            try:
                raw = doc.raw
                if isinstance(raw, bytes):
                    raw = raw.decode('utf-8')
                json_data = json.loads(raw)
                _logger.info("[PL_IMPORT] JSON cargado desde doc.raw")
                return json_data
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error leyendo raw: {e}")
        
        # MÉTODO 3: Desde spreadsheet_data (fallback, usualmente solo tiene plantilla inicial)
        if doc.spreadsheet_data:
            try:
                raw = doc.spreadsheet_data
                if isinstance(raw, bytes):
                    raw = raw.decode('utf-8')
                json_data = json.loads(raw)
                _logger.info("[PL_IMPORT] JSON cargado desde spreadsheet_data (puede ser solo plantilla)")
                return json_data
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error leyendo spreadsheet_data: {e}")
        
        # MÉTODO 4: Buscar attachment por res_model/res_id
        attachment = self.env['ir.attachment'].sudo().search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id),
            ('mimetype', '=', 'application/o-spreadsheet')
        ], limit=1, order='id desc')
        
        if attachment and attachment.datas:
            try:
                raw_bytes = base64.b64decode(attachment.datas)
                json_data = json.loads(raw_bytes.decode('utf-8'))
                _logger.info(f"[PL_IMPORT] JSON cargado desde ir.attachment búsqueda ({attachment.id})")
                return json_data
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error leyendo attachment encontrado: {e}")
        
        return json_data

    def _apply_pending_revisions(self, doc, idx):
        """Aplica revisiones pendientes sobre el índice de celdas"""
        # Buscar en spreadsheet.revision con múltiples criterios
        revision_domains = [
            [('res_model', '=', 'documents.document'), ('res_id', '=', doc.id)],
        ]
        
        # Si el documento está vinculado a otro modelo, buscar ahí también
        if doc.res_model and doc.res_id:
            revision_domains.append([
                ('res_model', '=', doc.res_model),
                ('res_id', '=', doc.res_id)
            ])
        
        total_revisions = 0
        for domain in revision_domains:
            revisions = self.env['spreadsheet.revision'].sudo().search(domain, order='id asc')
            _logger.info(f"[PL_IMPORT] Revisiones con dominio {domain}: {len(revisions)}")
            
            for rev in revisions:
                try:
                    commands = rev.commands
                    if isinstance(commands, str):
                        commands = json.loads(commands)
                    if isinstance(commands, list):
                        idx.apply_revision_commands(commands)
                        total_revisions += 1
                except Exception as e:
                    _logger.warning(f"[PL_IMPORT] Error procesando revisión {rev.id}: {e}")
        
        _logger.info(f"[PL_IMPORT] Total revisiones aplicadas: {total_revisions}")

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
            
            # Si no hay grosor, saltamos (fila vacía)
            if not grosor_val:
                continue
            
            _logger.info(f"[PL_IMPORT] Fila {row_idx + 1}: Grosor={grosor_val}")
            
            try:
                row_data = {
                    'product': prod,
                    'grosor': self._to_float(grosor_val),
                    'alto': self._to_float(idx.value(1, row_idx)),      # B
                    'ancho': self._to_float(idx.value(2, row_idx)),     # C
                    'bloque': str(idx.value(3, row_idx) or '').strip(),  # D
                    'atado': str(idx.value(4, row_idx) or '').strip(),   # E
                    'tipo': self._parse_tipo(idx.value(5, row_idx)),     # F
                    'pedimento': str(idx.value(6, row_idx) or '').strip(),  # G
                    'contenedor': str(idx.value(7, row_idx) or 'SN').strip(),  # H
                    'ref_proveedor': str(idx.value(8, row_idx) or '').strip(),  # I
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