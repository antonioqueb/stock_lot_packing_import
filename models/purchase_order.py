# -*- coding: utf-8 -*-
import base64
import io
import logging
import zipfile

from datetime import timedelta
from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class PurchaseOrderLine(models.Model):
    _inherit = 'purchase.order.line'

    x_qty_solicitada_original = fields.Float(
        string="Cant. Solicitada Original",
        digits='Product Unit of Measure',
        copy=False,
        readonly=True,
        help="Se congela la primera vez que se procesa el Packing List.",
    )
    x_qty_embarcada = fields.Float(
        string="Cant. Embarcada (PL)",
        digits='Product Unit of Measure',
        copy=False,
        readonly=True,
        help="Cantidad según Packing List. Es la cantidad a pagar al proveedor.",
    )


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    supplier_access_ids = fields.One2many(
        'stock.picking.supplier.access', 'purchase_id', string="Links Proveedor"
    )

    payment_document_ids = fields.One2many(
        'supplier.shipment.document',
        'purchase_id',
        string='Documentos de Pago'
    )

    payment_document_count = fields.Integer(
        compute='_compute_payment_documents',
        string='Docs de Pago',
    )

    has_payment_documents = fields.Boolean(
        compute='_compute_payment_documents',
        string='Tiene Docs de Pago',
    )

    vucem_document_ids = fields.Many2many(
        'supplier.shipment.document', compute='_compute_vucem_documents',
        string='Documentos VUCEM',
    )
    vucem_document_count = fields.Integer(
        compute='_compute_vucem_documents', string='Docs VUCEM',
    )
    has_vucem_documents = fields.Boolean(
        compute='_compute_vucem_documents', string='Tiene Docs VUCEM',
    )

    def _compute_payment_documents(self):
        payment_types = ['advance_payment', 'invoice_payment', 'other_payment']
        for po in self:
            docs = self.env['supplier.shipment.document'].sudo().search([
                ('purchase_id', '=', po.id),
                ('document_type', 'in', payment_types),
            ])
            po.payment_document_ids = docs
            po.payment_document_count = len(docs)
            po.has_payment_documents = len(docs) > 0

    def _compute_vucem_documents(self):
        for po in self:
            proforma = self.env['supplier.proforma.header'].sudo().search(
                [('purchase_id', '=', po.id)], limit=1
            )
            docs = self.env['supplier.shipment.document']
            if proforma:
                shipment_ids = proforma.shipment_ids.ids
                if shipment_ids:
                    docs |= self.env['supplier.shipment.document'].sudo().search([
                        ('shipment_id', 'in', shipment_ids),
                    ])
                docs |= self.env['supplier.shipment.document'].sudo().search([
                    ('proforma_id', '=', proforma.id),
                ])

            po.vucem_document_ids = docs
            po.vucem_document_count = len(docs)
            po.has_vucem_documents = len(docs) > 0

    def _get_target_incoming_picking_for_supplier_portal(self):
        self.ensure_one()
        pickings = self.picking_ids.filtered(
            lambda p: p.picking_type_code == 'incoming' and p.state not in ('done', 'cancel')
        )
        if not pickings:
            return False
        return pickings.sorted(key=lambda p: p.id, reverse=True)[0]

    def _get_or_create_supplier_access(self, target_picking):
        self.ensure_one()
        access = self.env['stock.picking.supplier.access'].sudo().search(
            [('purchase_id', '=', self.id)], limit=1
        )

        min_expiration = fields.Datetime.now() + timedelta(days=365)
        vals_update = {}

        if target_picking and (not access or access.picking_id.id != target_picking.id):
            vals_update['picking_id'] = target_picking.id

        # Siempre asegurar una vigencia mínima de 1 año
        if not access or not access.expiration_date or access.expiration_date < min_expiration:
            vals_update['expiration_date'] = min_expiration

        if access:
            if vals_update:
                access.write(vals_update)
            return access

        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        return self.env['stock.picking.supplier.access'].sudo().create({
            'purchase_id': self.id,
            'picking_id': target_picking.id,
            'expiration_date': min_expiration,
        })
    
    
    def action_open_supplier_link_wizard(self):
        self.ensure_one()
        if self.state not in ['purchase', 'done']:
            raise UserError(_("Debe confirmar la Orden de Compra antes de enviar el link al proveedor."))

        target_picking = self._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        self._get_or_create_supplier_access(target_picking)

        return {
            'type': 'ir.actions.act_window',
            'name': _('Link Portal Proveedor'),
            'res_model': 'purchase.supplier.portal.link.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_purchase_id': self.id,
            }
        }

    # =====================================================================
    #  VUCEM: Descarga de carpeta con PDFs procesados
    #  - Escala de grises 8-bit
    #  - Mínimo 300 DPI (upscale si es menor)
    #  - Sin hojas en blanco
    #  - QR bloqueados con parche BLANCO
    #  - Máximo 3MB por archivo (compresión progresiva)
    # =====================================================================

    def action_download_vucem(self):
        """
        Descarga un ZIP con los PDFs de la proforma procesados para VUCEM.
        """
        self.ensure_one()

        if not self.has_vucem_documents:
            raise UserError(_("No hay documentos subidos para generar la carpeta VUCEM."))

        try:
            from PIL import Image
        except ImportError:
            raise UserError(_("Se requiere la librería Pillow. Instale: pip install Pillow"))

        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise UserError(_("Se requiere PyMuPDF. Instale: pip install PyMuPDF"))

        folder_name = self.name or 'VUCEM'
        folder_name = folder_name.replace('/', '_').replace('\\', '_')

        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for doc in self.vucem_document_ids:
                if not doc.file_data:
                    continue

                file_bytes = base64.b64decode(doc.file_data)
                file_name = doc.name or 'documento.pdf'

                if not file_name.lower().endswith('.pdf'):
                    file_name += '.pdf'

                try:
                    processed = self._vucem_process_pdf(file_bytes, fitz, Image)
                    zf.writestr(f"{folder_name}/{file_name}", processed)
                except Exception as e:
                    _logger.warning(
                        "[VUCEM] Error procesando documento '%s': %s. Se incluye original.",
                        file_name, e
                    )
                    zf.writestr(f"{folder_name}/{file_name}", file_bytes)

        zip_buffer.seek(0)
        zip_data = base64.b64encode(zip_buffer.read())
        zip_name = f"VUCEM_{folder_name}.zip"

        attachment = self.env['ir.attachment'].create({
            'name': zip_name,
            'type': 'binary',
            'datas': zip_data,
            'res_model': 'purchase.order',
            'res_id': self.id,
            'mimetype': 'application/zip',
        })

        return {
            'type': 'ir.actions.act_url',
            'url': f'/web/content/{attachment.id}?download=true',
            'target': 'self',
        }

    def _vucem_process_pdf(self, file_bytes, fitz, Image):
        """
        Procesa un PDF para VUCEM:
        1. Renderiza cada página a mínimo 300 DPI (si ya es >= 300, usa su DPI nativo)
        2. Convierte a escala de grises 8-bit (modo "L")
        3. Detecta y bloquea QR codes con parche BLANCO
        4. Elimina hojas en blanco
        5. Si el resultado > 3MB, comprime progresivamente
        6. Re-ensambla como PDF
        """
        MIN_DPI = 300
        MAX_SIZE = 3 * 1024 * 1024  # 3MB

        doc = fitz.open(stream=file_bytes, filetype="pdf")

        # Paso 1: Estimar DPI del documento original
        original_dpi = self._vucem_estimate_document_dpi(doc)
        target_dpi = max(original_dpi, MIN_DPI)

        _logger.info(
            "[VUCEM] DPI original estimado: %d, DPI objetivo: %d, paginas: %d",
            original_dpi, target_dpi, len(doc)
        )

        # Paso 2: Renderizar páginas, convertir a grises 8-bit, bloquear QR, filtrar blancos
        page_images = []
        for page_num in range(len(doc)):
            page = doc[page_num]

            zoom = target_dpi / 72.0
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat, alpha=False)

            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            # Escala de grises 8-bit
            img_gray = img.convert("L")

            # Bloquear QR codes con parche BLANCO
            img_gray = self._vucem_block_qr_codes(img_gray, Image)

            # Verificar si la página está en blanco
            if self._vucem_is_blank_page(img_gray):
                _logger.info("[VUCEM] Pagina %d detectada como blanco, omitida.", page_num + 1)
                continue

            page_images.append(img_gray)

        doc.close()

        if not page_images:
            _logger.warning("[VUCEM] Todas las paginas estan en blanco, se retorna PDF original.")
            return file_bytes

        # Paso 3: Ensamblar PDF con las páginas procesadas
        result = self._vucem_assemble_pdf(page_images, fitz, target_dpi)

        # Paso 4: Comprimir si > 3MB
        if len(result) > MAX_SIZE:
            _logger.info(
                "[VUCEM] PDF resultante %d bytes > 3MB. Comprimiendo...",
                len(result)
            )
            result = self._vucem_compress_pdf(
                page_images, fitz, target_dpi, MAX_SIZE
            )

        _logger.info("[VUCEM] PDF final: %d bytes, %d paginas.", len(result), len(page_images))
        return result

    def _vucem_estimate_document_dpi(self, doc):
        """
        Estima el DPI del documento analizando las imágenes embebidas
        vs el tamaño de la MediaBox.
        Retorna el DPI máximo encontrado, o 72 si no se puede determinar.
        """
        max_dpi = 72
        try:
            for page_num in range(min(len(doc), 3)):  # Analizar primeras 3 páginas
                page = doc[page_num]
                rect = page.rect
                page_width_in = rect.width / 72.0
                page_height_in = rect.height / 72.0

                if page_width_in <= 0 or page_height_in <= 0:
                    continue

                images = page.get_images(full=True)
                for img_info in images:
                    xref = img_info[0]
                    try:
                        base_image = doc.extract_image(xref)
                        if base_image:
                            img_w = base_image.get("width", 0)
                            img_h = base_image.get("height", 0)
                            if img_w > 100 and img_h > 100:
                                dpi_w = img_w / page_width_in
                                dpi_h = img_h / page_height_in
                                avg_dpi = (dpi_w + dpi_h) / 2
                                if avg_dpi > max_dpi:
                                    max_dpi = avg_dpi
                    except Exception:
                        continue
        except Exception as e:
            _logger.info("[VUCEM] Error estimando DPI: %s", e)

        return int(round(max_dpi))

    def _vucem_is_blank_page(self, img_gray):
        """
        Determina si una imagen en escala de grises es una página en blanco.
        Una página se considera en blanco si el porcentaje de píxeles
        con valor > 250 (casi blancos) supera el 99.5%.
        """
        try:
            import numpy as np
            arr = np.array(img_gray)
            total_pixels = arr.size
            if total_pixels == 0:
                return True
            white_pixels = np.sum(arr > 250)
            white_ratio = white_pixels / total_pixels
            return white_ratio > 0.995
        except ImportError:
            # Sin numpy, usar sampling manual
            width, height = img_gray.size
            total = width * height
            if total == 0:
                return True

            sample_size = min(total, 10000)
            step = max(1, total // sample_size)
            pixels = img_gray.getdata()

            white_count = 0
            checked = 0
            for i in range(0, total, step):
                if pixels[i] > 250:
                    white_count += 1
                checked += 1

            if checked == 0:
                return True
            return (white_count / checked) > 0.995

    def _vucem_assemble_pdf(self, page_images, fitz, target_dpi, jpeg_quality=None):
        """
        Ensambla una lista de imágenes PIL (modo "L") en un PDF.
        Si jpeg_quality se proporciona, comprime con JPEG a esa calidad.
        """
        output_doc = fitz.open()

        for img_gray in page_images:
            if jpeg_quality:
                # Comprimir con JPEG
                jpeg_buf = io.BytesIO()
                # Convertir a RGB para JPEG (JPEG no soporta modo L directamente en todos los casos)
                img_rgb = img_gray.convert("RGB")
                img_rgb.save(jpeg_buf, format='JPEG', quality=jpeg_quality, optimize=True)
                jpeg_buf.seek(0)
                from PIL import Image as PILImage
                img_compressed = PILImage.open(jpeg_buf).convert("L")

                img_bytes = io.BytesIO()
                img_compressed.save(img_bytes, format='PDF', resolution=target_dpi)
            else:
                img_bytes = io.BytesIO()
                img_gray.save(img_bytes, format='PDF', resolution=target_dpi)

            img_bytes.seek(0)
            img_pdf = fitz.open(stream=img_bytes.read(), filetype="pdf")
            output_doc.insert_pdf(img_pdf)
            img_pdf.close()

        result = output_doc.tobytes()
        output_doc.close()
        return result

    def _vucem_compress_pdf(self, page_images, fitz, target_dpi, max_size):
        """
        Comprime progresivamente reduciendo calidad JPEG hasta caber en max_size.
        """
        for quality in [85, 70, 55, 40, 30, 20, 15]:
            try:
                result = self._vucem_assemble_pdf(
                    page_images, fitz, target_dpi, jpeg_quality=quality
                )
                if len(result) <= max_size:
                    _logger.info(
                        "[VUCEM] Compresion exitosa: %d bytes con JPEG quality=%d",
                        len(result), quality
                    )
                    return result
            except Exception as e:
                _logger.warning("[VUCEM] Error comprimiendo con quality=%d: %s", quality, e)
                continue

        # Si aún no cabe, reducir DPI a 200
        _logger.warning("[VUCEM] Reduciendo DPI a 200 para comprimir más.")
        for quality in [60, 40, 25]:
            try:
                # Re-renderizar a menor DPI
                reduced_images = []
                for img in page_images:
                    w, h = img.size
                    ratio = 200.0 / target_dpi
                    new_w = max(1, int(w * ratio))
                    new_h = max(1, int(h * ratio))
                    from PIL import Image as PILImage
                    reduced = img.resize((new_w, new_h), PILImage.LANCZOS)
                    reduced_images.append(reduced)

                result = self._vucem_assemble_pdf(
                    reduced_images, fitz, 200, jpeg_quality=quality
                )
                if len(result) <= max_size:
                    _logger.info(
                        "[VUCEM] Compresion con DPI reducido: %d bytes, quality=%d",
                        len(result), quality
                    )
                    return result
            except Exception as e:
                _logger.warning("[VUCEM] Error en compresion reducida: %s", e)
                continue

        # Último recurso: retornar lo mejor que se pueda
        _logger.warning("[VUCEM] No se pudo comprimir a menos de 3MB. Se retorna mejor resultado.")
        return self._vucem_assemble_pdf(page_images, fitz, target_dpi, jpeg_quality=20)

    def _vucem_block_qr_codes(self, img_gray, Image):
        """
        Detecta QR codes en la imagen y los bloquea con un
        rectángulo BLANCO (fill=255). Usa pyzbar si está disponible.
        """
        try:
            from pyzbar.pyzbar import decode as qr_decode
            from PIL import ImageDraw

            qr_results = qr_decode(img_gray)
            if qr_results:
                draw = ImageDraw.Draw(img_gray)
                for qr in qr_results:
                    rect = qr.rect
                    x0 = max(0, rect.left - 10)
                    y0 = max(0, rect.top - 10)
                    x1 = min(img_gray.width, rect.left + rect.width + 10)
                    y1 = min(img_gray.height, rect.top + rect.height + 10)
                    # ── PARCHE BLANCO (fill=255) en vez de negro ──
                    draw.rectangle([x0, y0, x1, y1], fill=255)

                _logger.info("[VUCEM] %d QR code(s) bloqueados (parche blanco) en la pagina.", len(qr_results))

        except ImportError:
            _logger.info("[VUCEM] pyzbar no disponible, QR detection desactivada.")
        except Exception as e:
            _logger.warning("[VUCEM] Error detectando QR: %s", e)

        return img_gray