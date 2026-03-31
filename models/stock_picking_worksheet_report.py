# -*- coding: utf-8 -*-
import base64
import io
import logging

from odoo import models, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def action_print_worksheet_pdf(self):
        """Genera un PDF imprimible del Worksheet para captura de medidas reales."""
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
            raise UserError(_('Se requiere la librería reportlab. Instale: pip install reportlab'))

        buffer = io.BytesIO()
        page_width, page_height = A4

        # ── Colores ──
        BRAND_DARK = HexColor('#6B4226')
        HEADER_BG = HexColor('#6B4226')
        HEADER_TEXT = white
        ROW_ALT = HexColor('#F9F6F3')
        BORDER_COLOR = HexColor('#D4D4D0')
        LIGHT_GRAY = HexColor('#F5F4F2')
        TEXT_PRIMARY = HexColor('#111111')
        TEXT_SECONDARY = HexColor('#4A4A4A')
        TEXT_MUTED = HexColor('#888888')
        YELLOW_BG = HexColor('#FFFBEB')
        YELLOW_BORDER = HexColor('#FDE68A')

        # ── Estilos ──
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
            fontName='Helvetica-Bold', fontSize=6,
            textColor=TEXT_SECONDARY, alignment=TA_LEFT,
        )
        style_value = ParagraphStyle(
            'WSValue', parent=styles['Normal'],
            fontName='Helvetica', fontSize=7,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT,
        )
        style_th = ParagraphStyle(
            'WSTH', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=5.5,
            textColor=HEADER_TEXT, alignment=TA_CENTER,
            leading=7,
        )
        style_td = ParagraphStyle(
            'WSTD', parent=styles['Normal'],
            fontName='Helvetica', fontSize=6.5,
            textColor=TEXT_PRIMARY, alignment=TA_CENTER,
            leading=8,
        )
        style_td_bold = ParagraphStyle(
            'WSTDBold', parent=style_td, fontName='Helvetica-Bold',
        )
        style_editable = ParagraphStyle(
            'WSEditable', parent=styles['Normal'],
            fontName='Helvetica', fontSize=6.5,
            textColor=TEXT_MUTED, alignment=TA_CENTER, leading=8,
        )

        # ── Datos ──
        picking = self
        po = self.env['purchase.order'].search([('picking_ids', 'in', picking.id)], limit=1)
        company = picking.company_id or self.env.company
        partner = picking.partner_id
        po_name = po.name if po else (picking.origin or '-')
        partner_name = partner.name if partner else '-'

        proforma_number = picking.supplier_proforma_number or ''
        invoice_number = picking.supplier_invoice_number or ''
        bl_number = picking.supplier_bl_number or ''
        vessel = picking.supplier_vessel or ''
        origin_port = picking.supplier_origin or ''
        dest_port = picking.supplier_destination or ''
        country_origin = picking.supplier_country_origin or ''
        container_no = picking.supplier_container_no or ''
        shipment_date = picking.supplier_shipment_date or ''
        incoterm = picking.supplier_incoterm_payment or ''

        # Agrupar por producto
        products_data = {}
        for ml in move_lines:
            pid = ml.product_id.id
            if pid not in products_data:
                products_data[pid] = {'product': ml.product_id, 'lines': []}
            products_data[pid]['lines'].append(ml)
        for pid in products_data:
            products_data[pid]['lines'].sort(key=lambda ml: ml.lot_id.name or '')

        # ── Story ──
        story = []
        margin_lr = 10 * mm
        avail_w = page_width - 2 * margin_lr

        # === ENCABEZADO ===
        story.append(Paragraph('WORKSHEET — MEDIDAS REALES', style_title))
        story.append(Paragraph(
            f'{picking.name}  |  {company.name}  |  {picking.create_date.strftime("%d/%m/%Y") if picking.create_date else ""}',
            style_subtitle,
        ))

        # === INFO COMPACTA ===
        def _r(l1, v1, l2, v2, l3, v3):
            return [
                Paragraph(l1, style_label), Paragraph(str(v1) if v1 else '-', style_value),
                Paragraph(l2, style_label), Paragraph(str(v2) if v2 else '-', style_value),
                Paragraph(l3, style_label), Paragraph(str(v3) if v3 else '-', style_value),
            ]

        info_data = [
            _r('OC', po_name, 'PROVEEDOR', partner_name, 'PROFORMA', proforma_number),
            _r('B/L', bl_number, 'BUQUE', vessel, 'CONTENEDOR', container_no),
            _r('ORIGEN', origin_port, 'DESTINO', dest_port, 'PAIS', country_origin),
            _r('INVOICE', invoice_number, 'INCOTERM', incoterm, 'EMBARQUE', shipment_date),
        ]
        info_cw = [avail_w * 0.09, avail_w * 0.24, avail_w * 0.09, avail_w * 0.24, avail_w * 0.10, avail_w * 0.24]
        info_table = Table(info_data, colWidths=info_cw)
        info_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), LIGHT_GRAY),
            ('BOX', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('INNERGRID', (0, 0), (-1, -1), 0.25, BORDER_COLOR),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 1.5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 1.5),
            ('LEFTPADDING', (0, 0), (-1, -1), 3),
            ('RIGHTPADDING', (0, 0), (-1, -1), 3),
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
            ('BOX', (0, 0), (-1, -1), 0.5, YELLOW_BORDER),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(instr)
        story.append(Spacer(1, 4))

        # === TABLA POR PRODUCTO ===
        # Columnas: # | Lote | Bloque | Placa | Atado | Alto Teo | Ancho Teo | M2 Teo | Alto Real | Ancho Real | M2 Real
        headers = [
            Paragraph('#', style_th),
            Paragraph('LOTE', style_th),
            Paragraph('BLOQUE', style_th),
            Paragraph('PLACA', style_th),
            Paragraph('ATADO', style_th),
            Paragraph('ALTO<br/>TEO.', style_th),
            Paragraph('ANCHO<br/>TEO.', style_th),
            Paragraph('M<super>2</super><br/>TEO.', style_th),
            Paragraph('ALTO<br/>REAL', style_th),
            Paragraph('ANCHO<br/>REAL', style_th),
            Paragraph('M<super>2</super><br/>REAL', style_th),
        ]

        col_widths = [
            avail_w * 0.035,   # #
            avail_w * 0.085,   # Lote
            avail_w * 0.085,   # Bloque
            avail_w * 0.060,   # Placa
            avail_w * 0.060,   # Atado
            avail_w * 0.078,   # Alto Teo
            avail_w * 0.078,   # Ancho Teo
            avail_w * 0.078,   # M2 Teo
            avail_w * 0.120,   # Alto Real
            avail_w * 0.120,   # Ancho Real
            avail_w * 0.100,   # M2 Real
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
            total_m2_teo = 0.0

            for ml in lines:
                lot = ml.lot_id
                row_num += 1
                alto = lot.x_alto or 0.0
                ancho = lot.x_ancho or 0.0
                m2_teo = round(alto * ancho, 3) if unit_type == 'Placa' else ml.qty_done
                total_m2_teo += m2_teo

                table_data.append([
                    Paragraph(str(row_num), style_td),
                    Paragraph(str(lot.name or ''), style_td_bold),
                    Paragraph(str(lot.x_bloque or ''), style_td),
                    Paragraph(str(lot.x_numero_placa or ''), style_td),
                    Paragraph(str(lot.x_atado or ''), style_td),
                    Paragraph(f'{alto:.3f}' if alto else '', style_td),
                    Paragraph(f'{ancho:.3f}' if ancho else '', style_td),
                    Paragraph(f'{m2_teo:.3f}' if m2_teo else '', style_td),
                    Paragraph('', style_editable),
                    Paragraph('', style_editable),
                    Paragraph('', style_editable),
                ])

            # Totales
            total_row = [Paragraph('', style_td)] * 11
            total_row[0] = Paragraph(
                f'<b>TOTAL: {row_num} lotes</b>',
                ParagraphStyle('t', parent=style_td, fontName='Helvetica-Bold', alignment=TA_LEFT, fontSize=6),
            )
            total_row[7] = Paragraph(f'<b>{total_m2_teo:.3f}</b>', style_td_bold)
            table_data.append(total_row)

            data_table = Table(table_data, colWidths=col_widths, repeatRows=1)
            tbl_styles = [
                ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
                ('TEXTCOLOR', (0, 0), (-1, 0), HEADER_TEXT),
                ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, 0), 3),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 3),
                ('TOPPADDING', (0, 1), (-1, -1), 1),
                ('BOTTOMPADDING', (0, 1), (-1, -1), 1),
                ('LEFTPADDING', (0, 0), (-1, -1), 2),
                ('RIGHTPADDING', (0, 0), (-1, -1), 2),
                ('BOX', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
                ('INNERGRID', (0, 0), (-1, -1), 0.25, BORDER_COLOR),
                # Editable cols (8,9,10)
                ('BACKGROUND', (8, 1), (10, -2), YELLOW_BG),
                ('BOX', (8, 0), (10, -1), 0.75, YELLOW_BORDER),
                ('BACKGROUND', (8, 0), (10, 0), HexColor('#92400E')),
                # Total
                ('BACKGROUND', (0, -1), (-1, -1), LIGHT_GRAY),
                ('LINEABOVE', (0, -1), (-1, -1), 0.75, BRAND_DARK),
                ('SPAN', (0, -1), (6, -1)),
            ]
            for i in range(1, len(table_data) - 1):
                if i % 2 == 0:
                    tbl_styles.append(('BACKGROUND', (0, i), (7, i), ROW_ALT))

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

        # ── Footer ──
        def add_page_number(canvas_obj, doc):
            canvas_obj.saveState()
            canvas_obj.setFont('Helvetica', 5)
            canvas_obj.setFillColor(HexColor('#888888'))
            canvas_obj.drawCentredString(page_width / 2, 7 * mm,
                                         f'Worksheet — {picking.name} — Pag. {doc.page}')
            canvas_obj.drawRightString(page_width - margin_lr, 7 * mm,
                                        f'OC: {po_name} | {partner_name}')
            canvas_obj.restoreState()

        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            leftMargin=margin_lr, rightMargin=margin_lr,
            topMargin=8 * mm, bottomMargin=12 * mm,
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