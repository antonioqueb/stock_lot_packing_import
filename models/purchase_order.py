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
        vals_update = {}
        if target_picking and (not access or access.picking_id.id != target_picking.id):
            vals_update['picking_id'] = target_picking.id
        vals_update['expiration_date'] = fields.Datetime.now() + timedelta(days=15)

        if access:
            if vals_update:
                access.write(vals_update)
            return access

        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        return self.env['stock.picking.supplier.access'].sudo().create({
            'purchase_id': self.id,
            'picking_id': target_picking.id,
            'expiration_date': vals_update['expiration_date'],
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
    #  VUCEM: Descarga de carpeta con PDFs en escala de grises / 600 DPI
    # =====================================================================

    def action_download_vucem(self):
        """
        Descarga un ZIP con los PDFs de la proforma:
        - Convertidos a escala de grises
        - Estandarizados a 600 DPI
        - QR codes bloqueados (blur/black patch)
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
        Procesa un PDF:
        1. Renderiza cada página a 600 DPI
        2. Convierte a escala de grises
        3. Detecta y bloquea QR codes
        4. Re-ensambla como PDF
        """
        TARGET_DPI = 600

        doc = fitz.open(stream=file_bytes, filetype="pdf")
        output_doc = fitz.open()

        for page_num in range(len(doc)):
            page = doc[page_num]

            zoom = TARGET_DPI / 72.0
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat, alpha=False)

            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            img_gray = img.convert("L")

            img_gray = self._vucem_block_qr_codes(img_gray, Image)

            img_bytes = io.BytesIO()
            img_gray.save(img_bytes, format='PDF', resolution=TARGET_DPI)
            img_bytes.seek(0)

            img_pdf = fitz.open(stream=img_bytes.read(), filetype="pdf")
            output_doc.insert_pdf(img_pdf)
            img_pdf.close()

        result = output_doc.tobytes()
        output_doc.close()
        doc.close()

        return result

    def _vucem_block_qr_codes(self, img_gray, Image):
        """
        Intenta detectar QR codes en la imagen y los bloquea con un
        rectángulo negro. Usa pyzbar si está disponible.
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
                    draw.rectangle([x0, y0, x1, y1], fill=0)

                _logger.info("[VUCEM] %d QR code(s) bloqueados en la pagina.", len(qr_results))

        except ImportError:
            _logger.info("[VUCEM] pyzbar no disponible, QR detection desactivada.")
        except Exception as e:
            _logger.warning("[VUCEM] Error detectando QR: %s", e)

        return img_gray