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
    """
    Normaliza celdas de un spreadsheet (Odoo) a una vista canónica:
      - Coordenadas 0-based: (col_idx, row_idx)
      - Acceso por letras A1 (A=0, row 1 => row_idx=0)
    Soporta formatos frecuentes:
      - {"A4": {"content": ...}}
      - {"0,3": {"content": ...}}
      - { "3": { "0": {"content": ...}, "1": ... } }  (por filas)
      - { 3: { 0: {...} } }                          (por filas int)
    """
    _A1_RE = re.compile(r"^([A-Z]+)(\d+)$")
    _CR_RE = re.compile(r"^(\d+),(\d+)$")

    def __init__(self, raw_cells):
        self._cells = {}  # (c, r) -> cell_dict
        self._raw_keys_sample = []
        self._ingest(raw_cells)

    @staticmethod
    def _col_letters_to_idx(letters: str) -> int:
        # A=1, B=2... (Excel style), convert to 0-based
        letters = letters.upper().strip()
        n = 0
        for ch in letters:
            n = n * 26 + (ord(ch) - ord('A') + 1)
        return n - 1

    @staticmethod
    def _idx_to_col_letters(idx: int) -> str:
        # 0 -> A, 25 -> Z, 26 -> AA...
        idx += 1
        s = ""
        while idx > 0:
            idx, rem = divmod(idx - 1, 26)
            s = chr(ord('A') + rem) + s
        return s

    def _put(self, c, r, cell):
        if c is None or r is None:
            return
        if not isinstance(cell, dict):
            cell = {"content": cell}
        self._cells[(int(c), int(r))] = cell

    def _ingest(self, raw_cells):
        if not raw_cells:
            return

        # Caso 1: dict con llaves string tipo "A4" o "0,3"
        if isinstance(raw_cells, dict):
            keys = list(raw_cells.keys())
            self._raw_keys_sample = [str(k) for k in keys[:80]]

            for k, v in raw_cells.items():
                # A1 style
                if isinstance(k, str):
                    m = self._A1_RE.match(k.strip().upper())
                    if m:
                        col_letters, row_num = m.group(1), int(m.group(2))
                        c = self._col_letters_to_idx(col_letters)
                        r = row_num - 1
                        self._put(c, r, v)
                        continue

                    # "c,r" style
                    m = self._CR_RE.match(k.strip())
                    if m:
                        c = int(m.group(1))
                        r = int(m.group(2))
                        self._put(c, r, v)
                        continue

                # Caso 2: dict por filas: {row_key: {col_key: cell}}
                # row_key puede ser int o str, col_key puede ser int o str
                if isinstance(v, dict) and (isinstance(k, (int, str))):
                    try:
                        r = int(k)
                    except Exception:
                        r = None
                    if r is not None:
                        for ck, cv in v.items():
                            try:
                                c = int(ck)
                            except Exception:
                                c = None
                            if c is not None:
                                self._put(c, r, cv)

    def get_cell(self, col_idx_0b: int, row_idx_0b: int):
        return self._cells.get((int(col_idx_0b), int(row_idx_0b)))

    def get_a1(self, a1: str):
        if not a1:
            return None
        a1 = a1.strip().upper()
        m = self._A1_RE.match(a1)
        if not m:
            return None
        c = self._col_letters_to_idx(m.group(1))
        r = int(m.group(2)) - 1
        return self.get_cell(c, r)

    def value(self, col_idx_0b: int, row_idx_0b: int):
        cell = self.get_cell(col_idx_0b, row_idx_0b)
        if not cell:
            return None

        # Odoo suele usar "content", pero toleramos variantes.
        for k in ("content", "value", "text", "displayValue"):
            if k in cell and cell[k] not in (None, ""):
                return cell[k]

        # Algunas variantes: {"cell": {"content": ...}}
        if isinstance(cell.get("cell"), dict):
            c = cell["cell"]
            for k in ("content", "value", "text"):
                if k in c and c[k] not in (None, ""):
                    return c[k]
        return None

    def debug_summary(self):
        return {
            "normalized_cells_count": len(self._cells),
            "raw_keys_sample": self._raw_keys_sample,
        }


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
            WHERE sl.name ~ '^[0-9]+-[0-9]+$'
              AND sp.state = 'done'
              AND sp.company_id = %s
            ORDER BY prefix_num DESC
            LIMIT 1
        """, (self.picking_id.company_id.id,))
        result = self.env.cr.fetchone()
        return (result[0] + 1) if result and result[0] else 1

    def _get_next_lot_number_for_prefix(self, prefix):
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
                return int(result[0].split('-')[1]) + 1
            except Exception:
                pass
        return 1

    def _format_lot_name(self, prefix, number):
        return f'{prefix}-{number:02d}' if number < 100 else f'{prefix}-{number}'

    # ---------------------------------------------------------
    # LOGGING/DEBUG HELPERS
    # ---------------------------------------------------------
    def _plog(self, msg, **kw):
        # Log “amigable” para grep
        if kw:
            msg = f"{msg} | " + " | ".join([f"{k}={kw[k]!r}" for k in sorted(kw.keys())])
        _logger.info("[PL_IMPORT] %s", msg)

    def _pdebug_dump_cells_window(self, idx: _PLCellsIndex, row_from=4, row_to=15, col_from='A', col_to='J'):
        # Muestra una ventanita A4:J15 (por defecto) para saber si hay algo.
        c0 = _PLCellsIndex._col_letters_to_idx(col_from)
        c1 = _PLCellsIndex._col_letters_to_idx(col_to)
        lines = []
        for r in range(row_from, row_to + 1):
            row_idx = r - 1
            row_vals = []
            for c in range(c0, c1 + 1):
                v = idx.value(c, row_idx)
                row_vals.append("" if v is None else str(v))
            if any(x != "" for x in row_vals):
                lines.append(f"R{r}: " + " | ".join(row_vals))
        return lines

    # ---------------------------------------------------------
    # ACCIÓN DE IMPORTACIÓN (EL MOTOR)
    # ---------------------------------------------------------
    def action_import_excel(self):
        self.ensure_one()
        self._plog("=== PROCESANDO CARGA DE LOTES ===",
                   picking=self.picking_id.name,
                   picking_id=self.picking_id.id,
                   has_excel=bool(self.excel_file),
                   has_spreadsheet=bool(self.picking_id.spreadsheet_id))

        rows_to_process = []
        if self.excel_file:
            rows_to_process = self._get_data_from_excel_file()
        elif self.picking_id.spreadsheet_id:
            rows_to_process = self._get_data_from_spreadsheet()
        else:
            raise UserError('No hay datos. Cargue un archivo Excel o llene la plantilla PL.')

        if not rows_to_process:
            raise UserError(
                "No se detectaron datos en las filas.\n\n"
                "Diagnóstico: el servidor no encontró valores en el rango A4:J...\n"
                "Revise el log con prefijo [PL_IMPORT].\n"
                "Sugerencia operativa: si el cursor estaba editando una celda, presione Enter y cierre para forzar guardado."
            )

        # Limpieza de líneas previas
        self.picking_id.move_line_ids.unlink()

        # Procesamiento
        move_lines_created = 0
        next_global_prefix = self._get_next_global_prefix()
        container_counters = {}

        for data in rows_to_process:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move:
                continue

            cont = (data.get('contenedor') or 'SN').strip() or 'SN'
            if cont not in container_counters:
                container_counters[cont] = {
                    'prefix': str(next_global_prefix),
                    'next_num': self._get_next_lot_number_for_prefix(str(next_global_prefix))
                }
                next_global_prefix += 1

            prefix = container_counters[cont]['prefix']
            lot_num = container_counters[cont]['next_num']
            lot_name = self._format_lot_name(prefix, lot_num)

            # Evitar duplicados (producto)
            while self.env['stock.lot'].search_count([('name', '=', lot_name), ('product_id', '=', product.id)]):
                lot_num += 1
                lot_name = self._format_lot_name(prefix, lot_num)

            lot = self.env['stock.lot'].create({
                'name': lot_name,
                'product_id': product.id,
                'company_id': self.picking_id.company_id.id,
                'x_grosor': data.get('grosor', 0.0),
                'x_alto': data.get('alto', 0.0),
                'x_ancho': data.get('ancho', 0.0),
                'x_bloque': data.get('bloque', ''),
                'x_atado': data.get('atado', ''),
                'x_tipo': data.get('tipo', 'placa'),
                'x_pedimento': data.get('pedimento', ''),
                'x_contenedor': cont,
                'x_referencia_proveedor': data.get('ref_proveedor', ''),
            })

            qty_done = (data.get('alto', 0.0) or 0.0) * (data.get('ancho', 0.0) or 0.0)
            if not qty_done:
                qty_done = 1.0

            self.env['stock.move_line'].create({
                'move_id': move.id,
                'product_id': product.id,
                'lot_id': lot.id,
                'qty_done': qty_done,
                'location_id': self.picking_id.location_id.id,
                'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
            })

            container_counters[cont]['next_num'] = lot_num + 1
            move_lines_created += 1

        self.picking_id.write({'packing_list_imported': True})
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Éxito',
                'message': f'Importación finalizada: {move_lines_created} lotes creados.',
                'type': 'success',
                'next': {'type': 'ir.actions.act_window_close'}
            }
        }

    # ---------------------------------------------------------
    # LECTOR SPREADSHEET (ULTRA TOLERANTE + DEBUG)
    # ---------------------------------------------------------
    def _get_data_from_spreadsheet(self):
        self.ensure_one()

        doc = self.picking_id.spreadsheet_id
        if not doc:
            return []

        # Fuerza re-lectura (evitar caché)
        doc = self.env['documents.document'].sudo().browse(doc.id)
        doc.read(['name', 'write_date', 'spreadsheet_data'])  # garantiza fetch en este request

        self._plog("Leyendo spreadsheet",
                   doc_id=doc.id,
                   doc_name=doc.name,
                   doc_write_date=str(doc.write_date),
                   spreadsheet_data_type=str(type(doc.spreadsheet_data)))

        raw_data = doc.spreadsheet_data
        # Normaliza bytes/str/dict
        if isinstance(raw_data, bytes):
            raw_data = raw_data.decode('utf-8', errors='replace')

        data_json = {}
        parse_err = None
        try:
            if isinstance(raw_data, str):
                data_json = json.loads(raw_data or "{}")
            elif isinstance(raw_data, dict):
                data_json = raw_data
            else:
                data_json = json.loads(raw_data or "{}") if raw_data else {}
        except Exception as e:
            parse_err = str(e)
            data_json = {}

        self._plog("Parse spreadsheet_data",
                   parsed_ok=bool(data_json),
                   parse_err=parse_err,
                   raw_len=(len(raw_data) if isinstance(raw_data, str) else None),
                   top_keys=list(data_json.keys())[:30] if isinstance(data_json, dict) else None)

        # Detecta hoja + cells
        sheets = data_json.get('sheets') if isinstance(data_json, dict) else None
        if not sheets or not isinstance(sheets, list):
            self._plog("Sin sheets[] en spreadsheet_data; devolviendo vacío")
            return self._raise_no_data_debug(doc, data_json, reason="spreadsheet_data sin sheets[]")

        sheet0 = sheets[0] if sheets else {}
        raw_cells = sheet0.get('cells') if isinstance(sheet0, dict) else None
        idx = _PLCellsIndex(raw_cells)

        dbg = idx.debug_summary()
        self._plog("Celdas normalizadas",
                   normalized_cells_count=dbg.get("normalized_cells_count"),
                   raw_keys_sample=dbg.get("raw_keys_sample"))

        # ------------- Intentar aplicar revisiones (si existen) -------------
        idx = self._apply_possible_revisions(doc, idx)

        # ------------- Lectura filas -------------
        default_product = self.picking_id.move_ids.mapped('product_id')[:1]
        if not default_product:
            raise UserError("No hay productos en la recepción (moves vacíos).")

        # Columnas A..J
        col_map = {
            'A': 0,  # grosor
            'B': 1,  # alto
            'C': 2,  # ancho
            'D': 3,  # bloque
            'E': 4,  # atado
            'F': 5,  # tipo
            'G': 6,  # pedimento
            'H': 7,  # contenedor
            'I': 8,  # ref proveedor
            'J': 9,  # notas (opcional)
        }

        def gv(letter, r):
            c = col_map[letter]
            row_idx = r - 1
            return idx.value(c, row_idx)

        rows = []
        # Ajusta a tu rango real (tu plantilla define hasta 100)
        for r in range(4, 501):
            g = gv('A', r)
            a = gv('B', r)
            an = gv('C', r)

            # fila vacía: nada en A,B,C y además no hay señales en D..I
            if g is None and a is None and an is None:
                # micro-optimización: si encontramos un bloque largo de vacíos al inicio, se puede cortar,
                # pero por debug prefiero seguir.
                continue

            try:
                grosor = float(str(g or 0).replace(',', '.')) if g not in ("", None) else 0.0
                alto = float(str(a or 0).replace(',', '.')) if a not in ("", None) else 0.0
                ancho = float(str(an or 0).replace(',', '.')) if an not in ("", None) else 0.0

                tipo_raw = (gv('F', r) or '')
                tipo_txt = str(tipo_raw).strip().lower()
                tipo = 'formato' if tipo_txt == 'formato' else 'placa'

                rows.append({
                    'product': default_product,
                    'grosor': grosor,
                    'alto': alto,
                    'ancho': ancho,
                    'bloque': str(gv('D', r) or '').strip(),
                    'atado': str(gv('E', r) or '').strip(),
                    'tipo': tipo,
                    'pedimento': str(gv('G', r) or '').strip(),
                    'contenedor': str(gv('H', r) or 'SN').strip(),
                    'ref_proveedor': str(gv('I', r) or '').strip(),
                    # 'notas': str(gv('J', r) or '').strip(),  # si luego lo necesitas
                })
            except Exception as e:
                self._plog("Fila ignorada por error parse",
                           row=r,
                           err=str(e),
                           a_val=a,
                           b_val=g,
                           c_val=an)
                continue

        self._plog("Resultado lectura spreadsheet",
                   rows_detected=len(rows))

        if not rows:
            # Dump ventana A4:J15 para diagnóstico
            window = self._pdebug_dump_cells_window(idx, 4, 15, 'A', 'J')
            self._plog("VENTANA A4:J15 (solo filas con algo)",
                       lines=window)
            return self._raise_no_data_debug(doc, data_json, reason="No se detectaron filas con datos (A4..)", idx=idx)

        return rows

    def _raise_no_data_debug(self, doc, data_json, reason="No data", idx=None):
        # Error extremadamente informativo (para ti)
        sheets = data_json.get('sheets') if isinstance(data_json, dict) else None
        sheet0 = sheets[0] if sheets and isinstance(sheets, list) else {}
        raw_cells = sheet0.get('cells') if isinstance(sheet0, dict) else None

        msg = (
            "No se detectaron datos en las filas del Spreadsheet.\n\n"
            f"Motivo: {reason}\n\n"
            "Diagnóstico (servidor):\n"
            f"- documents.document id: {doc.id}\n"
            f"- name: {doc.name}\n"
            f"- write_date: {doc.write_date}\n"
            f"- spreadsheet_data type: {type(doc.spreadsheet_data)}\n"
            f"- spreadsheet_data parsed keys: {list(data_json.keys())[:30] if isinstance(data_json, dict) else 'N/A'}\n"
            f"- sheet0 keys: {list(sheet0.keys())[:30] if isinstance(sheet0, dict) else 'N/A'}\n"
            f"- cells type: {type(raw_cells)}\n"
        )
        if idx:
            dbg = idx.debug_summary()
            msg += (
                f"- normalized_cells_count: {dbg.get('normalized_cells_count')}\n"
                f"- raw_keys_sample: {dbg.get('raw_keys_sample')}\n"
            )

        msg += (
            "\nAcciones sugeridas:\n"
            "1) Asegúrate de haber escrito valores dentro del rango A4:J100.\n"
            "2) Presiona Enter para salir de la celda antes de cerrar.\n"
            "3) Si persiste, copia y pega en el log la sección [PL_IMPORT] para ver qué formato exacto está llegando.\n"
        )
        raise UserError(msg)

    def _apply_possible_revisions(self, doc, idx: _PLCellsIndex):
        """
        Intenta aplicar revisiones si tu DB las está guardando (depende de edición/config).
        No rompe nada si no existe el modelo/campos; solo deja trazas.
        """
        # Modelos candidatos (según build/edición)
        candidates = [
            'spreadsheet.revision',
            'documents.spreadsheet.revision',
            'o_spreadsheet.revision',
        ]

        rev_model = None
        for m in candidates:
            try:
                rev_model = self.env[m].sudo()
                self._plog("Modelo revisiones encontrado", model=m)
                break
            except Exception:
                continue

        if not rev_model:
            self._plog("Sin modelo de revisiones disponible; se omite merge de revisiones")
            return idx

        # Dominios candidatos: (res_model/res_id) o (document_id)
        domains = [
            [('res_id', '=', doc.id)],  # tu versión original
            [('res_model', '=', doc._name), ('res_id', '=', doc.id)],
            [('document_id', '=', doc.id)],
        ]

        revs = []
        for d in domains:
            try:
                revs = rev_model.search(d, order='id asc')
                if revs:
                    self._plog("Revisiones encontradas", domain=d, count=len(revs))
                    break
            except Exception as e:
                self._plog("Dominio revisiones falló", domain=d, err=str(e))
                continue

        if not revs:
            self._plog("0 revisiones encontradas (se usará snapshot puro)")
            return idx

        applied = 0
        for rev in revs:
            # Campos candidatos donde Odoo guarda comandos
            commands_payload = None
            for fname in ('commands', 'command', 'payload', 'data'):
                if hasattr(rev, fname) and getattr(rev, fname):
                    commands_payload = getattr(rev, fname)
                    break

            if not commands_payload:
                continue

            if isinstance(commands_payload, bytes):
                commands_payload = commands_payload.decode('utf-8', errors='replace')

            try:
                cmds = json.loads(commands_payload) if isinstance(commands_payload, str) else commands_payload
            except Exception as e:
                self._plog("No se pudo parsear commands de revisión", rev_id=rev.id, err=str(e))
                continue

            if not isinstance(cmds, list):
                continue

            for cmd in cmds:
                if not isinstance(cmd, dict):
                    continue

                ctype = cmd.get('type') or cmd.get('name')
                # Variantes comunes
                if ctype in ('UPDATE_CELL', 'SET_CELL_CONTENT', 'setCell', 'updateCell'):
                    col = cmd.get('col')
                    row = cmd.get('row')
                    content = cmd.get('content')
                    if content is None and isinstance(cmd.get('cell'), dict):
                        content = cmd['cell'].get('content') or cmd['cell'].get('value')
                    if col is not None and row is not None:
                        # row/col suelen ser 0-based
                        try:
                            idx._put(int(col), int(row), {"content": content})
                            applied += 1
                        except Exception:
                            continue

        self._plog("Revisiones aplicadas al índice", applied=applied)
        return idx

    # ---------------------------------------------------------
    # LECTOR EXCEL (EL MÉTODO INFALIBLE)
    # ---------------------------------------------------------
    def _get_data_from_excel_file(self):
        try:
            from openpyxl import load_workbook
        except Exception:
            raise UserError('Instale openpyxl')

        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info:
                continue

            p_code = ''
            try:
                if '(' in str(p_info) and ')' in str(p_info):
                    p_code = str(p_info).split('(')[1].split(')')[0].strip()
            except Exception:
                p_code = ''

            product = self.env['product.product'].search(
                ['|', ('default_code', '=', p_code), ('name', '=', str(p_info).split('(')[0].strip())],
                limit=1
            )
            if not product:
                continue

            for r in range(4, sheet.max_row + 1):
                if not sheet.cell(r, 1).value and not sheet.cell(r, 2).value:
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
