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
        """Genera un PDF imprimible del Worksheet con datos del lote para captura de medidas reales."""
        self.ensure_one()

        if not self.packing_list_imported:
            raise UserError(_('Primero debe importar el Packing List antes de imprimir el Worksheet.'))

        move_lines = self.move_line_ids.filtered(lambda ml: ml.lot_id)
        if not move_lines:
            raise UserError(_('No hay lotes registrados para generar el Worksheet.'))

        try:
            from reportlab.lib.pagesizes import letter, landscape
            from reportlab.lib.units import inch, mm, cm
            from reportlab.lib.colors import HexColor, black, white, Color
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
            from reportlab.platypus import (
                SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
                PageBreak, KeepTogether,
            )
            from reportlab.pdfgen import canvas as pdf_canvas
        except ImportError:
            raise UserError(_('Se requiere la librería reportlab. Instale: pip install reportlab'))

        buffer = io.BytesIO()
        page_width, page_height = landscape(letter)

        # ── Colores ──
        BRAND_DARK = HexColor('#6B4226')
        BRAND_MED = HexColor('#A67C5B')
        BRAND_LIGHT = HexColor('#FAF8F6')
        HEADER_BG = HexColor('#6B4226')
        HEADER_TEXT = white
        ROW_ALT = HexColor('#F9F6F3')
        ROW_WHITE = white
        BORDER_COLOR = HexColor('#D4D4D0')
        LIGHT_GRAY = HexColor('#F5F4F2')
        TEXT_PRIMARY = HexColor('#111111')
        TEXT_SECONDARY = HexColor('#4A4A4A')
        TEXT_MUTED = HexColor('#888888')
        GREEN_BG = HexColor('#F0FDF4')
        GREEN_BORDER = HexColor('#BBF7D0')
        YELLOW_BG = HexColor('#FFFBEB')
        YELLOW_BORDER = HexColor('#FDE68A')

        # ── Estilos ──
        styles = getSampleStyleSheet()

        style_title = ParagraphStyle(
            'WSTitle', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=14,
            textColor=BRAND_DARK, alignment=TA_LEFT,
            spaceAfter=2,
        )
        style_subtitle = ParagraphStyle(
            'WSSubtitle', parent=styles['Normal'],
            fontName='Helvetica', fontSize=8,
            textColor=TEXT_MUTED, alignment=TA_LEFT,
            spaceAfter=6,
        )
        style_section = ParagraphStyle(
            'WSSection', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=9,
            textColor=BRAND_DARK, alignment=TA_LEFT,
            spaceBefore=8, spaceAfter=4,
        )
        style_label = ParagraphStyle(
            'WSLabel', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=7,
            textColor=TEXT_SECONDARY, alignment=TA_LEFT,
        )
        style_value = ParagraphStyle(
            'WSValue', parent=styles['Normal'],
            fontName='Helvetica', fontSize=8,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT,
        )
        style_th = ParagraphStyle(
            'WSTH', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=6.5,
            textColor=HEADER_TEXT, alignment=TA_CENTER,
            leading=8,
        )
        style_td = ParagraphStyle(
            'WSTD', parent=styles['Normal'],
            fontName='Helvetica', fontSize=7,
            textColor=TEXT_PRIMARY, alignment=TA_CENTER,
            leading=9,
        )
        style_td_left = ParagraphStyle(
            'WSTDLeft', parent=style_td,
            alignment=TA_LEFT,
        )
        style_td_bold = ParagraphStyle(
            'WSTDBold', parent=style_td,
            fontName='Helvetica-Bold',
        )
        style_editable = ParagraphStyle(
            'WSEditable', parent=styles['Normal'],
            fontName='Helvetica', fontSize=7,
            textColor=TEXT_MUTED, alignment=TA_CENTER,
            leading=9,
        )
        style_footer = ParagraphStyle(
            'WSFooter', parent=styles['Normal'],
            fontName='Helvetica', fontSize=6,
            textColor=TEXT_MUTED, alignment=TA_CENTER,
        )
        style_block_header = ParagraphStyle(
            'WSBlockHeader', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=7.5,
            textColor=BRAND_DARK, alignment=TA_LEFT,
            leading=10,
        )

        # ── Recopilar datos ──
        picking = self
        po = self.env['purchase.order'].search([
            ('picking_ids', 'in', picking.id)
        ], limit=1)

        company = picking.company_id or self.env.company
        partner = picking.partner_id
        po_name = po.name if po else (picking.origin or '-')
        partner_name = partner.name if partner else '-'
        partner_ref = partner.ref if partner and partner.ref else ''

        # Datos de embarque
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

        # Agrupar move_lines por producto
        products_data = {}
        for ml in move_lines:
            pid = ml.product_id.id
            if pid not in products_data:
                products_data[pid] = {
                    'product': ml.product_id,
                    'lines': [],
                }
            products_data[pid]['lines'].append(ml)

        # Ordenar líneas dentro de cada producto por nombre de lote
        for pid in products_data:
            products_data[pid]['lines'].sort(key=lambda ml: ml.lot_id.name or '')

        # ── Construir Story ──
        story = []

        # === ENCABEZADO PRINCIPAL ===
        story.append(Paragraph('WORKSHEET - CAPTURA DE MEDIDAS REALES', style_title))
        story.append(Paragraph(
            f'Recepcion: {picking.name} | Fecha de impresion: {picking.create_date.strftime("%d/%m/%Y") if picking.create_date else "-"}',
            style_subtitle,
        ))

        # === DATOS DE REFERENCIA (tabla compacta) ===
        info_data = []

        row1 = [
            Paragraph('ORDEN DE COMPRA', style_label),
            Paragraph(str(po_name), style_value),
            Paragraph('PROVEEDOR', style_label),
            Paragraph(str(partner_name), style_value),
            Paragraph('PROFORMA', style_label),
            Paragraph(str(proforma_number) if proforma_number else '-', style_value),
        ]
        info_data.append(row1)

        row2 = [
            Paragraph('B/L', style_label),
            Paragraph(str(bl_number) if bl_number else '-', style_value),
            Paragraph('BUQUE', style_label),
            Paragraph(str(vessel) if vessel else '-', style_value),
            Paragraph('CONTENEDOR(ES)', style_label),
            Paragraph(str(container_no) if container_no else '-', style_value),
        ]
        info_data.append(row2)

        row3 = [
            Paragraph('ORIGEN', style_label),
            Paragraph(str(origin_port) if origin_port else '-', style_value),
            Paragraph('DESTINO', style_label),
            Paragraph(str(dest_port) if dest_port else '-', style_value),
            Paragraph('PAIS ORIGEN', style_label),
            Paragraph(str(country_origin) if country_origin else '-', style_value),
        ]
        info_data.append(row3)

        row4 = [
            Paragraph('INVOICE', style_label),
            Paragraph(str(invoice_number) if invoice_number else '-', style_value),
            Paragraph('INCOTERM', style_label),
            Paragraph(str(incoterm) if incoterm else '-', style_value),
            Paragraph('FECHA EMBARQUE', style_label),
            Paragraph(str(shipment_date) if shipment_date else '-', style_value),
        ]
        info_data.append(row4)

        if po:
            row5 = [
                Paragraph('EMPRESA', style_label),
                Paragraph(str(company.name), style_value),
                Paragraph('RECEPCION', style_label),
                Paragraph(str(picking.name), style_value),
                Paragraph('ESTADO', style_label),
                Paragraph(str(dict(picking._fields['state'].selection).get(picking.state, picking.state)), style_value),
            ]
            info_data.append(row5)

        avail_w = page_width - 1.0 * inch
        info_col_widths = [
            avail_w * 0.12,  # label
            avail_w * 0.21,  # value
            avail_w * 0.12,  # label
            avail_w * 0.21,  # value
            avail_w * 0.13,  # label
            avail_w * 0.21,  # value
        ]

        info_table = Table(info_data, colWidths=info_col_widths, repeatRows=0)
        info_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), LIGHT_GRAY),
            ('BOX', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('INNERGRID', (0, 0), (-1, -1), 0.25, BORDER_COLOR),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            # Fondo ligeramente diferente en labels
            ('BACKGROUND', (0, 0), (0, -1), HexColor('#EDEBE8')),
            ('BACKGROUND', (2, 0), (2, -1), HexColor('#EDEBE8')),
            ('BACKGROUND', (4, 0), (4, -1), HexColor('#EDEBE8')),
        ]))

        story.append(info_table)
        story.append(Spacer(1, 10))

        # === INSTRUCCIONES ===
        instr_data = [[
            Paragraph(
                '<b>INSTRUCCIONES:</b> En las columnas <b>ALTO REAL</b> y <b>ANCHO REAL</b> '
                'registre las medidas obtenidas tras la inspeccion fisica de cada placa/pieza. '
                'Deje en blanco las piezas faltantes (se eliminaran al procesar). '
                'Use metros (m) como unidad de medida.',
                ParagraphStyle('WSInstr', parent=styles['Normal'],
                               fontName='Helvetica', fontSize=7,
                               textColor=HexColor('#92400E'), leading=9),
            )
        ]]
        instr_table = Table(instr_data, colWidths=[avail_w])
        instr_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), YELLOW_BG),
            ('BOX', (0, 0), (-1, -1), 0.75, YELLOW_BORDER),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(instr_table)
        story.append(Spacer(1, 8))

        # === TABLAS POR PRODUCTO ===
        for pid, pdata in products_data.items():
            product = pdata['product']
            lines = pdata['lines']
            unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'

            # Titulo del producto
            story.append(Paragraph(
                f'<b>{product.display_name}</b>  '
                f'<font color="#888888" size="7">({product.default_code or ""})</font>  '
                f'<font color="#6B4226" size="7">[{unit_type}]</font>  '
                f'<font color="#888888" size="6.5">— {len(lines)} lotes</font>',
                style_section,
            ))

            # Cabeceras de tabla
            headers = [
                Paragraph('#', style_th),
                Paragraph('LOTE', style_th),
                Paragraph('GROSOR', style_th),
                Paragraph('ALTO TEO.', style_th),
                Paragraph('ANCHO TEO.', style_th),
                Paragraph('M2 TEO.', style_th),
                Paragraph('COLOR', style_th),
                Paragraph('BLOQUE', style_th),
                Paragraph('No. PLACA', style_th),
                Paragraph('ATADO', style_th),
                Paragraph('CONTENEDOR', style_th),
                Paragraph('ALTO REAL (m)', style_th),
                Paragraph('ANCHO REAL (m)', style_th),
                Paragraph('M2 REAL', style_th),
            ]

            table_data = [headers]

            # Col widths
            col_widths = [
                avail_w * 0.030,   # #
                avail_w * 0.065,   # Lote
                avail_w * 0.055,   # Grosor
                avail_w * 0.060,   # Alto Teo
                avail_w * 0.060,   # Ancho Teo
                avail_w * 0.060,   # M2 Teo
                avail_w * 0.075,   # Color
                avail_w * 0.070,   # Bloque
                avail_w * 0.055,   # No Placa
                avail_w * 0.055,   # Atado
                avail_w * 0.080,   # Contenedor
                avail_w * 0.105,   # ALTO REAL
                avail_w * 0.105,   # ANCHO REAL
                avail_w * 0.070,   # M2 REAL
            ]

            # Agrupar por bloque
            current_block = None
            row_num = 0
            total_m2_teo = 0.0

            for ml in lines:
                lot = ml.lot_id
                bloque = lot.x_bloque or ''

                # Separador de bloque
                if bloque and bloque != current_block:
                    if current_block is not None:
                        # Fila separadora
                        sep_row = [Paragraph('', style_td)] * 14
                        sep_row[0] = Paragraph(
                            f'<b>Bloque: {bloque}</b>',
                            style_block_header,
                        )
                        table_data.append(sep_row)
                    current_block = bloque

                row_num += 1
                alto = lot.x_alto or 0.0
                ancho = lot.x_ancho or 0.0
                m2_teo = round(alto * ancho, 3) if unit_type == 'Placa' else ml.qty_done
                total_m2_teo += m2_teo

                row = [
                    Paragraph(str(row_num), style_td),
                    Paragraph(str(lot.name or ''), style_td_bold),
                    Paragraph(str(lot.x_grosor or ''), style_td),
                    Paragraph(f'{alto:.3f}' if alto else '', style_td),
                    Paragraph(f'{ancho:.3f}' if ancho else '', style_td),
                    Paragraph(f'{m2_teo:.3f}' if m2_teo else '', style_td),
                    Paragraph(str(lot.x_color or ''), style_td_left),
                    Paragraph(str(lot.x_bloque or ''), style_td),
                    Paragraph(str(lot.x_numero_placa or ''), style_td),
                    Paragraph(str(lot.x_atado or ''), style_td),
                    Paragraph(str(lot.x_contenedor or ''), style_td),
                    # Columnas editables (vacías para llenado manual)
                    Paragraph('', style_editable),
                    Paragraph('', style_editable),
                    Paragraph('', style_editable),
                ]
                table_data.append(row)

            # Fila de totales
            total_row = [Paragraph('', style_td)] * 14
            total_row[0] = Paragraph(f'<b>TOTAL: {row_num} lotes</b>', ParagraphStyle(
                'WSTotalLabel', parent=style_td, fontName='Helvetica-Bold', alignment=TA_LEFT, fontSize=7,
            ))
            total_row[5] = Paragraph(f'<b>{total_m2_teo:.3f}</b>', style_td_bold)
            table_data.append(total_row)

            # Construir tabla
            data_table = Table(table_data, colWidths=col_widths, repeatRows=1)

            # Estilos de tabla
            table_styles = [
                # Header
                ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
                ('TEXTCOLOR', (0, 0), (-1, 0), HEADER_TEXT),
                ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, 0), 4),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 4),

                # Body
                ('TOPPADDING', (0, 1), (-1, -1), 2),
                ('BOTTOMPADDING', (0, 1), (-1, -1), 2),
                ('LEFTPADDING', (0, 0), (-1, -1), 3),
                ('RIGHTPADDING', (0, 0), (-1, -1), 3),

                # Borders
                ('BOX', (0, 0), (-1, -1), 0.75, BORDER_COLOR),
                ('INNERGRID', (0, 0), (-1, -1), 0.25, BORDER_COLOR),

                # Editable columns highlight
                ('BACKGROUND', (11, 1), (13, -2), YELLOW_BG),
                ('BOX', (11, 0), (13, -1), 1.0, YELLOW_BORDER),

                # Header editable columns special
                ('BACKGROUND', (11, 0), (13, 0), HexColor('#92400E')),

                # Total row
                ('BACKGROUND', (0, -1), (-1, -1), LIGHT_GRAY),
                ('LINEABOVE', (0, -1), (-1, -1), 1.0, BRAND_DARK),

                # Span total label
                ('SPAN', (0, -1), (4, -1)),
            ]

            # Filas alternas
            for i in range(1, len(table_data) - 1):
                if i % 2 == 0:
                    # Solo aplicar a columnas no editables
                    table_styles.append(('BACKGROUND', (0, i), (10, i), ROW_ALT))

            data_table.setStyle(TableStyle(table_styles))
            story.append(data_table)
            story.append(Spacer(1, 12))

        # === SECCIÓN DE FIRMAS ===
        story.append(Spacer(1, 20))

        sign_data = [[
            Paragraph('', style_td),
            Paragraph('', style_td),
            Paragraph('', style_td),
        ], [
            Paragraph('________________________', style_td),
            Paragraph('________________________', style_td),
            Paragraph('________________________', style_td),
        ], [
            Paragraph('<b>Revisado por</b>', ParagraphStyle('s', parent=style_td, fontSize=7)),
            Paragraph('<b>Medido por</b>', ParagraphStyle('s', parent=style_td, fontSize=7)),
            Paragraph('<b>Autorizado por</b>', ParagraphStyle('s', parent=style_td, fontSize=7)),
        ], [
            Paragraph('Nombre: _______________', ParagraphStyle('s', parent=style_td, fontSize=6.5, textColor=TEXT_MUTED)),
            Paragraph('Nombre: _______________', ParagraphStyle('s', parent=style_td, fontSize=6.5, textColor=TEXT_MUTED)),
            Paragraph('Nombre: _______________', ParagraphStyle('s', parent=style_td, fontSize=6.5, textColor=TEXT_MUTED)),
        ], [
            Paragraph('Fecha: _______________', ParagraphStyle('s', parent=style_td, fontSize=6.5, textColor=TEXT_MUTED)),
            Paragraph('Fecha: _______________', ParagraphStyle('s', parent=style_td, fontSize=6.5, textColor=TEXT_MUTED)),
            Paragraph('Fecha: _______________', ParagraphStyle('s', parent=style_td, fontSize=6.5, textColor=TEXT_MUTED)),
        ]]

        sign_col_w = avail_w / 3
        sign_table = Table(sign_data, colWidths=[sign_col_w] * 3)
        sign_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]))
        story.append(sign_table)

        # ── Page number footer ──
        def add_page_number(canvas_obj, doc):
            canvas_obj.saveState()
            canvas_obj.setFont('Helvetica', 6)
            canvas_obj.setFillColor(TEXT_MUTED)
            canvas_obj.drawCentredString(
                page_width / 2, 0.35 * inch,
                f'Worksheet — {picking.name} — Pagina {doc.page}'
            )
            # Marca de agua sutil
            canvas_obj.setFont('Helvetica', 5)
            canvas_obj.drawRightString(
                page_width - 0.5 * inch, 0.35 * inch,
                f'OC: {po_name} | {partner_name}'
            )
            canvas_obj.restoreState()

        # ── Construir PDF ──
        doc = SimpleDocTemplate(
            buffer,
            pagesize=landscape(letter),
            leftMargin=0.5 * inch,
            rightMargin=0.5 * inch,
            topMargin=0.5 * inch,
            bottomMargin=0.5 * inch,
            title=f'Worksheet - {picking.name}',
            author=company.name or 'Odoo',
        )

        doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)

        # ── Guardar y descargar ──
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