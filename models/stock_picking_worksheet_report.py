# -*- coding: utf-8 -*-
import base64
import io
import logging
from datetime import date
from html import escape

from odoo import models, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    # -------------------------------------------------------------------------
    # HELPERS WORKSHEET
    # -------------------------------------------------------------------------

    def _ws_safe_text(self, value):
        return escape(str(value or '').strip())

    def _ws_get_linked_transit_voyage_for_report(self):
        self.ensure_one()

        if 'stock.transit.voyage' not in self.env.registry.models:
            return False

        Voyage = self.env['stock.transit.voyage'].sudo()

        voyage = Voyage.search([
            ('reception_picking_id', '=', self.id),
        ], limit=1)

        if voyage:
            return voyage

        if self.origin:
            origin_ref = (self.origin or '').split(' ')[0]
            if origin_ref:
                voyage = Voyage.search([
                    ('name', 'ilike', origin_ref),
                    ('custom_status', 'not in', ['delivered', 'cancel']),
                ], order='id desc', limit=1)

        return voyage

    def _ws_owner_label_from_transit_line(self, transit_line):
        if not transit_line:
            return ''

        order = transit_line.order_id
        partner = transit_line.partner_id

        allocation = transit_line.allocation_id
        if allocation:
            order = order or allocation.sale_order_id
            partner = partner or allocation.partner_id

        if order and not partner:
            partner = order.partner_id

        if partner and order:
            return '%s / %s' % (partner.display_name or partner.name or '', order.name or '')

        if partner:
            return partner.display_name or partner.name or ''

        if order:
            return order.name or ''

        if transit_line.allocation_status == 'available':
            return 'Stock libre'

        return ''

    def _ws_transit_owner_priority(self, transit_line):
        if not transit_line:
            return 0

        if transit_line.order_id and transit_line.partner_id:
            return 50

        if transit_line.order_id:
            return 40

        if transit_line.partner_id:
            return 35

        if transit_line.allocation_id and transit_line.allocation_id.sale_order_id:
            return 30

        if transit_line.allocation_id and transit_line.allocation_id.partner_id:
            return 25

        if transit_line.allocation_status == 'reserved':
            return 20

        if transit_line.allocation_status == 'available':
            return 10

        return 0

    def _ws_get_owner_map_for_report(self, move_lines):
        self.ensure_one()

        owner_map = {}

        if 'stock.transit.line' not in self.env.registry.models:
            return owner_map

        lots = move_lines.mapped('lot_id')
        products = move_lines.mapped('product_id')

        if not lots or not products:
            return owner_map

        TransitLine = self.env['stock.transit.line'].sudo()
        voyage = self._ws_get_linked_transit_voyage_for_report()

        domain = [
            ('lot_id', 'in', lots.ids),
            ('product_id', 'in', products.ids),
        ]

        if voyage:
            domain.append(('voyage_id', '=', voyage.id))
        else:
            domain.append(('voyage_id.custom_status', 'not in', ['delivered', 'cancel']))

        transit_lines = TransitLine.search(domain, order='id desc')

        best_priority = {}

        for transit_line in transit_lines:
            if not transit_line.lot_id or not transit_line.product_id:
                continue

            key = (transit_line.product_id.id, transit_line.lot_id.id)
            priority = self._ws_transit_owner_priority(transit_line)

            if key in best_priority and best_priority[key] >= priority:
                continue

            label = self._ws_owner_label_from_transit_line(transit_line)
            owner_map[key] = label or ''
            best_priority[key] = priority

        return owner_map

    # -------------------------------------------------------------------------
    # REPORTE PDF
    # -------------------------------------------------------------------------

    def action_print_worksheet_pdf(self):
        self.ensure_one()

        if not self.packing_list_imported:
            raise UserError(_('Primero debe importar el Packing List antes de imprimir el Worksheet.'))

        move_lines = self.move_line_ids.filtered(lambda ml: ml.lot_id)
        if not move_lines:
            raise UserError(_('No hay lotes registrados para generar el Worksheet.'))

        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.units import mm
            from reportlab.lib.colors import HexColor, white
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.enums import TA_LEFT, TA_CENTER
            from reportlab.platypus import (
                SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
            )
        except ImportError:
            raise UserError(_('Se requiere reportlab. Instale: pip install reportlab'))

        buffer = io.BytesIO()
        page_width, page_height = A4

        BRAND_DARK = HexColor('#6B4226')
        HEADER_BG = HexColor('#6B4226')
        HEADER_TEXT = white
        ROW_ALT = HexColor('#F9F6F3')
        BORDER_COLOR = HexColor('#D4D4D0')
        BORDER_STRONG = HexColor('#999999')
        LIGHT_GRAY = HexColor('#F5F4F2')
        TEXT_PRIMARY = HexColor('#111111')
        TEXT_SECONDARY = HexColor('#4A4A4A')
        TEXT_MUTED = HexColor('#888888')
        YELLOW_BG = HexColor('#FFFBEB')
        YELLOW_BORDER = HexColor('#D4A017')
        DIVIDER_COLOR = HexColor('#6B4226')

        styles = getSampleStyleSheet()

        style_title = ParagraphStyle(
            'WSTitle', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=11,
            textColor=BRAND_DARK, alignment=TA_LEFT, spaceAfter=1,
        )
        style_subtitle = ParagraphStyle(
            'WSSubtitle', parent=styles['Normal'],
            fontName='Helvetica', fontSize=7,
            textColor=TEXT_MUTED, alignment=TA_LEFT, spaceAfter=3,
        )
        style_section = ParagraphStyle(
            'WSSection', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=8,
            textColor=BRAND_DARK, alignment=TA_LEFT,
            spaceBefore=5, spaceAfter=2,
        )
        style_label = ParagraphStyle(
            'WSLabel', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=6.5,
            textColor=TEXT_SECONDARY, alignment=TA_LEFT,
        )
        style_value = ParagraphStyle(
            'WSValue', parent=styles['Normal'],
            fontName='Helvetica', fontSize=7.5,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT,
        )
        style_th = ParagraphStyle(
            'WSTH', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=5.6,
            textColor=HEADER_TEXT, alignment=TA_CENTER,
            leading=7,
        )
        style_td = ParagraphStyle(
            'WSTD', parent=styles['Normal'],
            fontName='Helvetica', fontSize=6.4,
            textColor=TEXT_PRIMARY, alignment=TA_CENTER,
            leading=8,
        )
        style_td_bold = ParagraphStyle(
            'WSTDBold', parent=style_td, fontName='Helvetica-Bold',
        )
        style_td_owner = ParagraphStyle(
            'WSTDOwner', parent=styles['Normal'],
            fontName='Helvetica', fontSize=5.4,
            textColor=TEXT_PRIMARY, alignment=TA_CENTER,
            leading=6.5,
        )
        style_editable = ParagraphStyle(
            'WSEditable', parent=styles['Normal'],
            fontName='Helvetica', fontSize=6.4,
            textColor=TEXT_MUTED, alignment=TA_CENTER, leading=8,
        )

        picking = self
        po = self.env['purchase.order'].search([('picking_ids', 'in', picking.id)], limit=1)
        company = picking.company_id or self.env.company
        partner = picking.partner_id
        po_name = po.name if po else (picking.origin or '-')
        partner_name = partner.name if partner else '-'
        container_no = picking.supplier_container_no or '-'
        fecha_recepcion = picking.scheduled_date.strftime('%d/%m/%Y') if picking.scheduled_date else '-'
        fecha_impresion = date.today().strftime('%d/%m/%Y')

        owner_map = picking._ws_get_owner_map_for_report(move_lines)

        products_data = {}
        for ml in move_lines:
            pid = ml.product_id.id
            if pid not in products_data:
                products_data[pid] = {'product': ml.product_id, 'lines': []}
            products_data[pid]['lines'].append(ml)

        for pid in products_data:
            products_data[pid]['lines'].sort(key=lambda ml: ml.lot_id.name or '')

        story = []
        margin_lr = 8 * mm
        avail_w = page_width - 2 * margin_lr

        # === ENCABEZADO ===
        story.append(Paragraph('WORKSHEET — MEDIDAS REALES', style_title))
        story.append(Paragraph(
            '%s  |  %s' % (
                self._ws_safe_text(picking.name),
                self._ws_safe_text(company.name),
            ),
            style_subtitle,
        ))

        # === CABECERA COMPACTA ===
        info_data = [
            [
                Paragraph('PROVEEDOR', style_label),
                Paragraph(self._ws_safe_text(partner_name), style_value),
                Paragraph('ORDEN DE COMPRA', style_label),
                Paragraph(self._ws_safe_text(po_name), style_value),
                Paragraph('CONTENEDOR', style_label),
                Paragraph(self._ws_safe_text(container_no), style_value),
            ],
            [
                Paragraph('FECHA RECEPCION', style_label),
                Paragraph(self._ws_safe_text(fecha_recepcion), style_value),
                Paragraph('FECHA IMPRESION', style_label),
                Paragraph(self._ws_safe_text(fecha_impresion), style_value),
                Paragraph('', style_label),
                Paragraph('', style_value),
            ],
        ]

        info_cw = [
            avail_w * 0.12,
            avail_w * 0.22,
            avail_w * 0.12,
            avail_w * 0.22,
            avail_w * 0.12,
            avail_w * 0.20,
        ]

        info_table = Table(info_data, colWidths=info_cw)
        info_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), LIGHT_GRAY),
            ('BOX', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('INNERGRID', (0, 0), (-1, -1), 0.25, BORDER_COLOR),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ('BACKGROUND', (0, 0), (0, -1), HexColor('#EDEBE8')),
            ('BACKGROUND', (2, 0), (2, -1), HexColor('#EDEBE8')),
            ('BACKGROUND', (4, 0), (4, -1), HexColor('#EDEBE8')),
        ]))
        story.append(info_table)
        story.append(Spacer(1, 3))

        # === INSTRUCCIONES ===
        instr = Table([[Paragraph(
            '<b>INSTRUCCIONES:</b> Placas: registre <b>ALTO REAL</b> y <b>LARGO REAL</b> (metros). '
            'Formatos: registre la <b>CANT. REAL</b> contra la teórica. '
            'Use la columna <b>DUEÑO</b> para identificar material preasignado/asignado desde embarque. '
            'Deje en blanco las piezas faltantes.',
            ParagraphStyle(
                'i',
                parent=styles['Normal'],
                fontName='Helvetica',
                fontSize=6,
                textColor=HexColor('#92400E'),
                leading=7,
            ),
        )]], colWidths=[avail_w])
        instr.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), YELLOW_BG),
            ('BOX', (0, 0), (-1, -1), 0.5, HexColor('#FDE68A')),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(instr)
        story.append(Spacer(1, 4))

        # === TABLA POR PRODUCTO ===
        headers_placa = [
            Paragraph('#', style_th),
            Paragraph('LOTE', style_th),
            Paragraph('BLOQUE', style_th),
            Paragraph('PLACA', style_th),
            Paragraph('ATADO', style_th),
            Paragraph('DUEÑO', style_th),
            Paragraph('ALTO TEO.', style_th),
            Paragraph('LARGO TEO.', style_th),
            Paragraph('ALTO REAL', style_th),
            Paragraph('LARGO REAL', style_th),
        ]

        col_widths_placa = [
            avail_w * 0.035,
            avail_w * 0.095,
            avail_w * 0.130,
            avail_w * 0.085,
            avail_w * 0.105,
            avail_w * 0.160,
            avail_w * 0.095,
            avail_w * 0.095,
            avail_w * 0.100,
            avail_w * 0.100,
        ]

        # Formatos: sin dimensiones; solo cantidad teórica vs real.
        headers_formato = [
            Paragraph('#', style_th),
            Paragraph('LOTE', style_th),
            Paragraph('BLOQUE', style_th),
            Paragraph('PLACA', style_th),
            Paragraph('ATADO', style_th),
            Paragraph('DUEÑO', style_th),
            Paragraph('CANT. TEÓRICA', style_th),
            Paragraph('CANT. REAL', style_th),
        ]

        col_widths_formato = [
            avail_w * 0.035,
            avail_w * 0.110,
            avail_w * 0.150,
            avail_w * 0.105,
            avail_w * 0.130,
            avail_w * 0.190,
            avail_w * 0.140,
            avail_w * 0.140,
        ]

        for pid, pdata in products_data.items():
            product = pdata['product']
            lines = pdata['lines']
            unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
            is_placa = str(unit_type).strip().lower() == 'placa'
            headers = headers_placa if is_placa else headers_formato
            col_widths = col_widths_placa if is_placa else col_widths_formato

            story.append(Paragraph(
                '<b>%s</b> '
                '<font color="#888888" size="6">(%s)</font> '
                '<font color="#6B4226" size="6">[%s]</font> '
                '<font color="#888888" size="5.5">— %s lotes</font>' % (
                    self._ws_safe_text(product.display_name),
                    self._ws_safe_text(product.default_code or ''),
                    self._ws_safe_text(unit_type),
                    len(lines),
                ),
                style_section,
            ))

            table_data = [headers]
            row_num = 0

            for ml in lines:
                lot = ml.lot_id
                row_num += 1

                alto = lot.x_alto or 0.0
                ancho = lot.x_ancho or 0.0
                owner_key = (ml.product_id.id, lot.id)
                owner_name = owner_map.get(owner_key) or ''

                if is_placa:
                    table_data.append([
                        Paragraph(str(row_num), style_td),
                        Paragraph(self._ws_safe_text(lot.name), style_td_bold),
                        Paragraph(self._ws_safe_text(lot.x_bloque), style_td),
                        Paragraph(self._ws_safe_text(lot.x_numero_placa), style_td),
                        Paragraph(self._ws_safe_text(lot.x_atado), style_td),
                        Paragraph(self._ws_safe_text(owner_name), style_td_owner),
                        Paragraph(f'{alto:.3f}' if alto else '', style_td),
                        Paragraph(f'{ancho:.3f}' if ancho else '', style_td),
                        Paragraph('', style_editable),
                        Paragraph('', style_editable),
                    ])
                else:
                    qty_teo = self._ws_move_line_qty(ml)
                    table_data.append([
                        Paragraph(str(row_num), style_td),
                        Paragraph(self._ws_safe_text(lot.name), style_td_bold),
                        Paragraph(self._ws_safe_text(lot.x_bloque), style_td),
                        Paragraph(self._ws_safe_text(lot.x_numero_placa), style_td),
                        Paragraph(self._ws_safe_text(lot.x_atado), style_td),
                        Paragraph(self._ws_safe_text(owner_name), style_td_owner),
                        Paragraph(f'{qty_teo:.2f}', style_td),
                        Paragraph('', style_editable),
                    ])

            total_row = [Paragraph('', style_td)] * (10 if is_placa else 8)
            total_row[0] = Paragraph(
                '<b>TOTAL: %s lotes</b>' % row_num,
                ParagraphStyle(
                    't',
                    parent=style_td,
                    fontName='Helvetica-Bold',
                    alignment=TA_LEFT,
                    fontSize=6.5,
                ),
            )
            table_data.append(total_row)

            data_table = Table(table_data, colWidths=col_widths, repeatRows=1)

            edit_first = 8 if is_placa else 7
            edit_last = 9 if is_placa else 7
            teo_last = 7 if is_placa else 6

            tbl_styles = [
                ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
                ('TEXTCOLOR', (0, 0), (-1, 0), HEADER_TEXT),
                ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, 0), 4),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 4),
                ('TOPPADDING', (0, 1), (-1, -1), 2),
                ('BOTTOMPADDING', (0, 1), (-1, -1), 2),
                ('LEFTPADDING', (0, 0), (-1, -1), 2.4),
                ('RIGHTPADDING', (0, 0), (-1, -1), 2.4),
                ('BOX', (0, 0), (-1, -1), 0.75, BORDER_STRONG),
                ('INNERGRID', (0, 0), (-1, -1), 0.25, BORDER_COLOR),
                ('LINEBELOW', (0, 0), (-1, 0), 1.5, DIVIDER_COLOR),

                # Separadores lógicos:
                # Datos de identificación | dueño | teórico | captura real.
                ('LINEAFTER', (4, 0), (4, -1), 1.2, DIVIDER_COLOR),
                ('LINEAFTER', (5, 0), (5, -1), 1.2, DIVIDER_COLOR),
                ('LINEAFTER', (teo_last, 0), (teo_last, -1), 1.5, DIVIDER_COLOR),

                # Columnas editables (Alto/Largo Real o Cant. Real).
                ('BACKGROUND', (edit_first, 1), (edit_last, -2), YELLOW_BG),
                ('BOX', (edit_first, 0), (edit_last, -1), 1.0, YELLOW_BORDER),
                ('BACKGROUND', (edit_first, 0), (edit_last, 0), HexColor('#92400E')),

                ('BACKGROUND', (0, -1), (-1, -1), LIGHT_GRAY),
                ('LINEABOVE', (0, -1), (-1, -1), 1.0, BRAND_DARK),
                ('SPAN', (0, -1), (teo_last, -1)),
            ]

            for i in range(1, len(table_data)):
                tbl_styles.append(('LINEBELOW', (0, i), (-1, i), 0.5, BORDER_STRONG))

            for i in range(1, len(table_data) - 1):
                if i % 2 == 0:
                    tbl_styles.append(('BACKGROUND', (0, i), (teo_last, i), ROW_ALT))

            data_table.setStyle(TableStyle(tbl_styles))
            story.append(data_table)
            story.append(Spacer(1, 6))

        # === FIRMAS ===
        story.append(Spacer(1, 10))
        s_s = ParagraphStyle('ss', parent=style_td, fontSize=6.5)
        s_l = ParagraphStyle('sl', parent=style_td, fontName='Helvetica-Bold', fontSize=6.5)
        s_m = ParagraphStyle('sm', parent=style_td, fontSize=5.5, textColor=TEXT_MUTED)

        sign_data = [
            [
                Paragraph('________________________', s_s),
                Paragraph('________________________', s_s),
                Paragraph('________________________', s_s),
            ],
            [
                Paragraph('<b>Revisado por</b>', s_l),
                Paragraph('<b>Medido por</b>', s_l),
                Paragraph('<b>Autorizado por</b>', s_l),
            ],
            [
                Paragraph('Nombre / Fecha', s_m),
                Paragraph('Nombre / Fecha', s_m),
                Paragraph('Nombre / Fecha', s_m),
            ],
        ]
        sign_table = Table(sign_data, colWidths=[avail_w / 3] * 3)
        sign_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
        ]))
        story.append(sign_table)

        def add_page_number(canvas_obj, doc):
            canvas_obj.saveState()
            canvas_obj.setFont('Helvetica', 5)
            canvas_obj.setFillColor(HexColor('#888888'))
            canvas_obj.drawCentredString(
                page_width / 2,
                6 * mm,
                'Worksheet — %s — Pag. %s' % (picking.name, doc.page),
            )
            canvas_obj.drawRightString(
                page_width - margin_lr,
                6 * mm,
                'OC: %s | %s' % (po_name, partner_name),
            )
            canvas_obj.restoreState()

        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=margin_lr,
            rightMargin=margin_lr,
            topMargin=8 * mm,
            bottomMargin=10 * mm,
            title='Worksheet - %s' % picking.name,
            author=company.name or 'Odoo',
        )
        doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)

        pdf_data = buffer.getvalue()
        buffer.close()

        filename = 'Worksheet_%s.pdf' % (picking.name or 'SIN_REFERENCIA')
        filename = filename.replace('/', '_')

        attachment = self.env['ir.attachment'].create({
            'name': filename,
            'type': 'binary',
            'datas': base64.b64encode(pdf_data),
            'res_model': 'stock.picking',
            'res_id': picking.id,
            'mimetype': 'application/pdf',
        })

        return {
            'type': 'ir.actions.act_url',
            'url': '/web/content/%s?download=true' % attachment.id,
            'target': 'self',
        }