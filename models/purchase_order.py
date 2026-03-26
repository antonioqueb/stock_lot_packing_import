# -*- coding: utf-8 -*-
import base64
import io
import logging
import zipfile

from datetime import timedelta
from odoo import models, fields, _
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
        'stock.picking.supplier.access',
        'purchase_id',
        string="Links Proveedor",
    )

    payment_document_ids = fields.One2many(
        'supplier.shipment.document',
        'purchase_id',
        string='Documentos de Pago',
        domain=[('document_type', 'in', ['advance_payment', 'invoice_payment', 'other_payment'])],
    )

    payment_document_count = fields.Integer(
        compute='_compute_payment_documents',
        string='Docs de Pago',
    )

    has_payment_documents = fields.Boolean(
        compute='_compute_payment_documents',
        string='Tiene Docs de Pago',
    )

    vucem_document_ids = fields.One2many(
        'supplier.shipment.document',
        compute='_compute_vucem_document_ids',
        string='Documentos VUCEM',
    )

    vucem_document_count = fields.Integer(
        compute='_compute_vucem_documents',
        string='Docs VUCEM',
    )

    has_vucem_documents = fields.Boolean(
        compute='_compute_vucem_documents',
        string='Tiene Docs VUCEM',
    )

    def _compute_payment_documents(self):
        payment_types = ['advance_payment', 'invoice_payment', 'other_payment']
        doc_model = self.env['supplier.shipment.document'].sudo()

        for po in self:
            docs = doc_model.search([
                ('purchase_id', '=', po.id),
                ('document_type', 'in', payment_types),
            ])
            po.payment_document_count = len(docs)
            po.has_payment_documents = bool(docs)

    def _compute_vucem_documents(self):
        for po in self:
            docs = po._get_all_vucem_documents()
            po.vucem_document_count = len(docs)
            po.has_vucem_documents = bool(docs)

    def _compute_vucem_document_ids(self):
        for po in self:
            po.vucem_document_ids = po._get_all_vucem_documents()

    def _get_all_vucem_documents(self):
        """Retorna todos los documentos VUCEM como recordset real."""
        self.ensure_one()
        proforma_model = self.env['supplier.proforma.header'].sudo()
        doc_model = self.env['supplier.shipment.document'].sudo()

        docs = doc_model
        proforma = proforma_model.search([('purchase_id', '=', self.id)], limit=1)

        if proforma:
            shipment_ids = proforma.shipment_ids.ids
            if shipment_ids:
                docs |= doc_model.search([('shipment_id', 'in', shipment_ids)])
            docs |= doc_model.search([
                ('proforma_id', '=', proforma.id),
                ('shipment_id', '=', 0),
            ])

        # Documentos de pago internos
        docs |= doc_model.search([('purchase_id', '=', self.id)])

        return docs

    def _get_or_create_supplier_access(self):
        self.ensure_one()

        access = self.env['stock.picking.supplier.access'].sudo().search(
            [('purchase_id', '=', self.id)],
            limit=1,
        )

        min_expiration = fields.Datetime.now() + timedelta(days=365)

        if access:
            vals = {}
            if not access.expiration_date or access.expiration_date < min_expiration:
                vals['expiration_date'] = min_expiration
            if vals:
                access.write(vals)
            return access

        return self.env['stock.picking.supplier.access'].sudo().create({
            'purchase_id': self.id,
            'expiration_date': min_expiration,
        })

    def action_open_supplier_link_wizard(self):
        self.ensure_one()

        if self.state not in ['purchase', 'done']:
            raise UserError(_("Debe confirmar la Orden de Compra antes de enviar el link al proveedor."))

        self._get_or_create_supplier_access()

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
    # =====================================================================

    def action_download_vucem(self):
        self.ensure_one()

        all_docs = self._get_all_vucem_documents()

        if not all_docs:
            raise UserError(_("No hay documentos subidos para generar la carpeta VUCEM."))

        try:
            from PIL import Image
        except ImportError:
            raise UserError(_("Se requiere la librería Pillow. Instale: pip install Pillow"))

        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise UserError(_("Se requiere PyMuPDF. Instale: pip install PyMuPDF"))

        folder_name = (self.name or 'VUCEM').replace('/', '_').replace('\\', '_')
        zip_buffer = io.BytesIO()
        payment_types = {'advance_payment', 'invoice_payment', 'other_payment'}

        _logger.info(
            "[VUCEM] Iniciando descarga para OC %s. Total documentos: %d",
            self.name, len(all_docs)
        )

        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            file_names_used = set()

            for doc in all_docs:
                if not doc.file_data:
                    _logger.warning(
                        "[VUCEM] Documento '%s' (ID %d, tipo %s) sin file_data, omitido.",
                        doc.name, doc.id, doc.document_type
                    )
                    continue

                try:
                    file_bytes = base64.b64decode(doc.file_data)
                except Exception as e:
                    _logger.warning(
                        "[VUCEM] Error decodificando file_data de doc '%s' (ID %d): %s",
                        doc.name, doc.id, e
                    )
                    continue

                file_name = doc.name or 'documento'
                mime_type = (doc.mime_type or '').lower()
                is_pdf = (
                    mime_type == 'application/pdf'
                    or file_name.lower().endswith('.pdf')
                )

                # Subcarpeta según tipo
                if doc.document_type in payment_types:
                    sub_folder = "Pagos"
                else:
                    sub_folder = "Documentos"

                if is_pdf:
                    if not file_name.lower().endswith('.pdf'):
                        file_name += '.pdf'
                    try:
                        processed = self._vucem_process_pdf(file_bytes, fitz, Image)
                        file_bytes = processed
                    except Exception as e:
                        _logger.warning(
                            "[VUCEM] Error procesando PDF '%s': %s. Se incluye original.",
                            file_name, e
                        )
                else:
                    _logger.info(
                        "[VUCEM] Documento '%s' no es PDF (mime: %s). Se incluye sin procesar.",
                        file_name, mime_type
                    )

                # Evitar nombres duplicados
                final_name = file_name
                counter = 1
                while final_name in file_names_used:
                    if '.' in file_name:
                        name_base, name_ext = file_name.rsplit('.', 1)
                        final_name = f"{name_base}_{counter}.{name_ext}"
                    else:
                        final_name = f"{file_name}_{counter}"
                    counter += 1
                file_names_used.add(final_name)

                zip_path = f"{folder_name}/{sub_folder}/{final_name}"
                zf.writestr(zip_path, file_bytes)

                _logger.info(
                    "[VUCEM] Incluido: %s (%d bytes, tipo: %s, doc_id: %d)",
                    zip_path, len(file_bytes), doc.document_type, doc.id
                )

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
        MIN_DPI = 300
        MAX_SIZE = 3 * 1024 * 1024

        doc = fitz.open(stream=file_bytes, filetype="pdf")
        original_dpi = self._vucem_estimate_document_dpi(doc)
        target_dpi = max(original_dpi, MIN_DPI)

        _logger.info(
            "[VUCEM] DPI original estimado: %d, DPI objetivo: %d, paginas: %d",
            original_dpi, target_dpi, len(doc)
        )

        page_images = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            zoom = target_dpi / 72.0
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat, alpha=False)

            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            img_gray = img.convert("L")
            img_gray = self._vucem_block_qr_codes(img_gray, Image)

            if self._vucem_is_blank_page(img_gray):
                _logger.info("[VUCEM] Pagina %d detectada como blanco, omitida.", page_num + 1)
                continue

            page_images.append(img_gray)

        doc.close()

        if not page_images:
            _logger.warning("[VUCEM] Todas las paginas estan en blanco, se retorna PDF original.")
            return file_bytes

        result = self._vucem_assemble_pdf(page_images, fitz, target_dpi)

        if len(result) > MAX_SIZE:
            _logger.info("[VUCEM] PDF resultante %d bytes > 3MB. Comprimiendo...", len(result))
            result = self._vucem_compress_pdf(page_images, fitz, target_dpi, MAX_SIZE)

        _logger.info("[VUCEM] PDF final: %d bytes, %d paginas.", len(result), len(page_images))
        return result

    def _vucem_estimate_document_dpi(self, doc):
        max_dpi = 72
        try:
            for page_num in range(min(len(doc), 3)):
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
        output_doc = fitz.open()

        for img_gray in page_images:
            if jpeg_quality:
                jpeg_buf = io.BytesIO()
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

        _logger.warning("[VUCEM] Reduciendo DPI a 200 para comprimir más.")
        for quality in [60, 40, 25]:
            try:
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

        _logger.warning("[VUCEM] No se pudo comprimir a menos de 3MB. Se retorna mejor resultado.")
        return self._vucem_assemble_pdf(page_images, fitz, target_dpi, jpeg_quality=20)

    def _vucem_block_qr_codes(self, img_gray, Image):
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
                    draw.rectangle([x0, y0, x1, y1], fill=255)

                _logger.info("[VUCEM] %d QR code(s) bloqueados (parche blanco) en la pagina.", len(qr_results))

        except ImportError:
            _logger.info("[VUCEM] pyzbar no disponible, QR detection desactivada.")
        except Exception as e:
            _logger.warning("[VUCEM] Error detectando QR: %s", e)

        return img_gray