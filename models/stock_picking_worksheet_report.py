# -*- coding: utf-8 -*-
import base64
import io
import logging
from datetime import date

from odoo import models, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class StockPicking(models.Model):
    _inherit = 'stock.picking'

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
            fontName='Helvetica-Bold', fontSize=6,
            textColor=HEADER_TEXT, alignment=TA_CENTER,
            leading=8,
        )
        style_td = ParagraphStyle(
            'WSTD', parent=styles['Normal'],
            fontName='Helvetica', fontSize=7,
            textColor=TEXT_PRIMARY, alignment=TA_CENTER,
            leading=9,
        )
        style_td_bold = ParagraphStyle(
            'WSTDBold', parent=style_td, fontName='Helvetica-Bold',
        )
        style_editable = ParagraphStyle(
            'WSEditable', parent=styles['Normal'],
            fontName='Helvetica', fontSize=7,
            textColor=TEXT_MUTED, alignment=TA_CENTER, leading=9,
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
        story.append(Paragraph(f'{picking.name}  |  {company.name}', style_subtitle))

        # === CABECERA COMPACTA: solo 5 datos ===
        info_data = [
            [
                Paragraph('PROVEEDOR', style_label),
                Paragraph(str(partner_name), style_value),
                Paragraph('ORDEN DE COMPRA', style_label),
                Paragraph(str(po_name), style_value),
                Paragraph('CONTENEDOR', style_label),
                Paragraph(str(container_no), style_value),
            ],
            [
                Paragraph('FECHA RECEPCION', style_label),
                Paragraph(str(fecha_recepcion), style_value),
                Paragraph('FECHA IMPRESION', style_label),
                Paragraph(str(fecha_impresion), style_value),
                Paragraph('', style_label),
                Paragraph('', style_value),
            ],
        ]
        info_cw = [avail_w * 0.12, avail_w * 0.22, avail_w * 0.12, avail_w * 0.22, avail_w * 0.12, avail_w * 0.20]
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
            '<b>INSTRUCCIONES:</b> Registre <b>ALTO REAL</b> y <b>ANCHO REAL</b> (metros). '
            'Deje en blanco las piezas faltantes.',
            ParagraphStyle('i', parent=styles['Normal'], fontName='Helvetica', fontSize=6,
                           textColor=HexColor('#92400E'), leading=7),
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
        headers = [
            Paragraph('#', style_th),
            Paragraph('LOTE', style_th),
            Paragraph('BLOQUE', style_th),
            Paragraph('PLACA', style_th),
            Paragraph('ATADO', style_th),
            Paragraph('ALTO TEO.', style_th),
            Paragraph('ANCHO TEO.', style_th),
            Paragraph('ALTO REAL', style_th),
            Paragraph('ANCHO REAL', style_th),
        ]

        col_widths = [
            avail_w * 0.04,
            avail_w * 0.10,
            avail_w * 0.15,
            avail_w * 0.10,
            avail_w * 0.13,
            avail_w * 0.12,
            avail_w * 0.12,
            avail_w * 0.12,
            avail_w * 0.12,
        ]

        for pid, pdata in products_data.items():
            product = pdata['product']
            lines = pdata['lines']
            unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'

            story.append(Paragraph(
                f'<b>{product.display_name}</b> '
                f'<font color="#888888" size="6">({product.default_code or ""})</font> '
                f'<font color="#6B4226" size="6">[{unit_type}]</font> '
                f'<font color="#888888" size="5.5">— {len(lines)} lotes</font>',
                style_section,
            ))

            table_data = [headers]
            row_num = 0

            for ml in lines:
                lot = ml.lot_id
                row_num += 1
                alto = lot.x_alto or 0.0
                ancho = lot.x_ancho or 0.0

                table_data.append([
                    Paragraph(str(row_num), style_td),
                    Paragraph(str(lot.name or ''), style_td_bold),
                    Paragraph(str(lot.x_bloque or ''), style_td),
                    Paragraph(str(lot.x_numero_placa or ''), style_td),
                    Paragraph(str(lot.x_atado or ''), style_td),
                    Paragraph(f'{alto:.3f}' if alto else '', style_td),
                    Paragraph(f'{ancho:.3f}' if ancho else '', style_td),
                    Paragraph('', style_editable),
                    Paragraph('', style_editable),
                ])

            total_row = [Paragraph('', style_td)] * 9
            total_row[0] = Paragraph(
                f'<b>TOTAL: {row_num} lotes</b>',
                ParagraphStyle('t', parent=style_td, fontName='Helvetica-Bold', alignment=TA_LEFT, fontSize=6.5),
            )
            table_data.append(total_row)

            data_table = Table(table_data, colWidths=col_widths, repeatRows=1)

            tbl_styles = [
                ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
                ('TEXTCOLOR', (0, 0), (-1, 0), HEADER_TEXT),
                ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, 0), 4),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 4),
                ('TOPPADDING', (0, 1), (-1, -1), 2),
                ('BOTTOMPADDING', (0, 1), (-1, -1), 2),
                ('LEFTPADDING', (0, 0), (-1, -1), 3),
                ('RIGHTPADDING', (0, 0), (-1, -1), 3),
                ('BOX', (0, 0), (-1, -1), 0.75, BORDER_STRONG),
                ('INNERGRID', (0, 0), (-1, -1), 0.25, BORDER_COLOR),
                ('LINEBELOW', (0, 0), (-1, 0), 1.5, DIVIDER_COLOR),
                ('LINEAFTER', (4, 0), (4, -1), 1.5, DIVIDER_COLOR),
                ('LINEAFTER', (6, 0), (6, -1), 1.5, DIVIDER_COLOR),
                ('BACKGROUND', (7, 1), (8, -2), YELLOW_BG),
                ('BOX', (7, 0), (8, -1), 1.0, YELLOW_BORDER),
                ('BACKGROUND', (7, 0), (8, 0), HexColor('#92400E')),
                ('BACKGROUND', (0, -1), (-1, -1), LIGHT_GRAY),
                ('LINEABOVE', (0, -1), (-1, -1), 1.0, BRAND_DARK),
                ('SPAN', (0, -1), (6, -1)),
            ]

            for i in range(1, len(table_data)):
                tbl_styles.append(('LINEBELOW', (0, i), (-1, i), 0.5, BORDER_STRONG))

            for i in range(1, len(table_data) - 1):
                if i % 2 == 0:
                    tbl_styles.append(('BACKGROUND', (0, i), (6, i), ROW_ALT))

            data_table.setStyle(TableStyle(tbl_styles))
            story.append(data_table)
            story.append(Spacer(1, 6))

        # === FIRMAS ===
        story.append(Spacer(1, 10))
        s_s = ParagraphStyle('ss', parent=style_td, fontSize=6.5)
        s_l = ParagraphStyle('sl', parent=style_td, fontName='Helvetica-Bold', fontSize=6.5)
        s_m = ParagraphStyle('sm', parent=style_td, fontSize=5.5, textColor=TEXT_MUTED)

        sign_data = [
            [Paragraph('________________________', s_s),
             Paragraph('________________________', s_s),
             Paragraph('________________________', s_s)],
            [Paragraph('<b>Revisado por</b>', s_l),
             Paragraph('<b>Medido por</b>', s_l),
             Paragraph('<b>Autorizado por</b>', s_l)],
            [Paragraph('Nombre / Fecha', s_m),
             Paragraph('Nombre / Fecha', s_m),
             Paragraph('Nombre / Fecha', s_m)],
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
            canvas_obj.drawCentredString(page_width / 2, 6 * mm,
                                         f'Worksheet — {picking.name} — Pag. {doc.page}')
            canvas_obj.drawRightString(page_width - margin_lr, 6 * mm,
                                        f'OC: {po_name} | {partner_name}')
            canvas_obj.restoreState()

        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            leftMargin=margin_lr, rightMargin=margin_lr,
            topMargin=8 * mm, bottomMargin=10 * mm,
            title=f'Worksheet - {picking.name}',
            author=company.name or 'Odoo',
        )
        doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)

        pdf_data = buffer.getvalue()
        buffer.close()

        filename = f'Worksheet_{picking.name}.pdf'.replace('/', '_')
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
            'url': f'/web/content/{attachment.id}?download=true',
            'target': 'self',
        }