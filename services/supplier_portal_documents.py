# -*- coding: utf-8 -*-

import base64
import hashlib
import io
import logging

from odoo.http import request

from .supplier_portal_base import SupplierPortalBaseService

_logger = logging.getLogger(__name__)


class SupplierPortalDocumentsService(SupplierPortalBaseService):
    """
    Servicio para documentos del portal:
    - serialización
    - upload/delete/list
    - normalización PDF
    - endpoint legacy upload_file

    IMPORTANTE:
    Los documentos de pago YA NO se gestionan desde el portal.
    """

    SHIPMENT_DOC_TYPES = [
        "bl",
        "invoice",
        "packing_list",
        "eur1",
        "certificate_origin",
        "fumigation",
    ]

    ALL_VALID_DOC_TYPES = SHIPMENT_DOC_TYPES

    def serialize_document(self, doc):
        return {
            "id": doc.id,
            "document_type": doc.document_type,
            "name": doc.name or "",
            "file_size": doc.file_size or 0,
            "mime_type": doc.mime_type or "",
            "dpi_value": doc.dpi_value or 0,
            "upload_token": doc.upload_token or "",
            "notes": doc.notes or "",
        }

    def serialize_documents_for_scope(self, shipment_id=None, proforma_id=None):
        doc_model = request.env["supplier.shipment.document"].sudo()
        domain = []

        if shipment_id:
            domain.append(("shipment_id", "=", shipment_id))
        elif proforma_id:
            domain.append(("proforma_id", "=", proforma_id))
        else:
            return []

        docs = doc_model.search(domain, order="document_type, create_date desc")
        return [self.serialize_document(doc) for doc in docs]

    # =====================================================================
    #  PDF HELPERS
    # =====================================================================

    def normalize_pdf_for_upload(self, file_data_b64, dpi_value):
        try:
            import fitz
            from PIL import Image
        except ImportError:
            _logger.warning("[Portal] PyMuPDF o Pillow no disponible, PDF se guarda sin procesar.")
            return file_data_b64, dpi_value

        try:
            file_bytes = base64.b64decode(file_data_b64)
        except Exception:
            return file_data_b64, dpi_value

        needs_upscale = (dpi_value > 0 and dpi_value < 300) or dpi_value == 0

        if not needs_upscale:
            if len(file_bytes) > 3 * 1024 * 1024:
                compressed = self.compress_pdf_to_max_size(file_bytes, fitz, Image, 300)
                if compressed:
                    return base64.b64encode(compressed).decode("ascii"), dpi_value
            return file_data_b64, dpi_value

        target_dpi = 300

        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            output_doc = fitz.open()

            for page_num in range(len(doc)):
                page = doc[page_num]
                zoom = target_dpi / 72.0
                mat = fitz.Matrix(zoom, zoom)
                pix = page.get_pixmap(matrix=mat, alpha=False)

                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

                img_bytes = io.BytesIO()
                img.save(img_bytes, format="PDF", resolution=target_dpi)
                img_bytes.seek(0)

                img_pdf = fitz.open(stream=img_bytes.read(), filetype="pdf")
                output_doc.insert_pdf(img_pdf)
                img_pdf.close()

            result = output_doc.tobytes()
            output_doc.close()
            doc.close()

            if len(result) > 3 * 1024 * 1024:
                compressed = self.compress_pdf_to_max_size(result, fitz, Image, target_dpi)
                if compressed:
                    result = compressed

            return base64.b64encode(result).decode("ascii"), target_dpi

        except Exception as err:
            _logger.warning("[Portal] Error normalizando PDF: %s. Se guarda original.", err)
            return file_data_b64, dpi_value

    def compress_pdf_to_max_size(self, pdf_bytes, fitz, Image, target_dpi):
        max_size = 3 * 1024 * 1024

        for quality in [85, 70, 55, 40, 30, 20]:
            try:
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                output_doc = fitz.open()

                for page_num in range(len(doc)):
                    page = doc[page_num]
                    zoom = target_dpi / 72.0
                    mat = fitz.Matrix(zoom, zoom)
                    pix = page.get_pixmap(matrix=mat, alpha=False)

                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

                    jpeg_buf = io.BytesIO()
                    img.save(jpeg_buf, format="JPEG", quality=quality, optimize=True)
                    jpeg_buf.seek(0)
                    img_compressed = Image.open(jpeg_buf)

                    pdf_buf = io.BytesIO()
                    img_compressed.save(pdf_buf, format="PDF", resolution=target_dpi)
                    pdf_buf.seek(0)

                    page_pdf = fitz.open(stream=pdf_buf.read(), filetype="pdf")
                    output_doc.insert_pdf(page_pdf)
                    page_pdf.close()

                result = output_doc.tobytes()
                output_doc.close()
                doc.close()

                if len(result) <= max_size:
                    _logger.info(
                        "[Portal] PDF comprimido a %d bytes con quality=%d",
                        len(result),
                        quality,
                    )
                    return result

            except Exception as err:
                _logger.warning(
                    "[Portal] Error comprimiendo PDF (quality=%d): %s",
                    quality,
                    err,
                )
                continue

        _logger.warning("[Portal] No se pudo comprimir PDF a menos de 3MB.")
        return None

    # =====================================================================
    #  API LOGIC: DOCUMENTOS
    # =====================================================================

    def upload_document(self, token, payload):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token invalido."}

        document_type = payload.get("document_type")
        file_data = payload.get("file_data")
        file_name = payload.get("file_name")
        shipment_id = payload.get("shipment_id")
        file_size = payload.get("file_size", 0)
        mime_type = payload.get("mime_type", "")
        dpi_value = payload.get("dpi_value", 0)
        notes = payload.get("notes", "")

        if not document_type or not file_data or not file_name:
            return {
                "success": False,
                "message": "Faltan parametros requeridos (document_type, file_data, file_name).",
            }

        proforma = self.get_or_create_proforma(access)
        if not proforma:
            return {"success": False, "message": "Proforma no encontrada."}

        if document_type not in self.ALL_VALID_DOC_TYPES:
            return {
                "success": False,
                "message": "Este tipo de documento ya no puede gestionarse desde el portal.",
            }

        shipment = None
        if not shipment_id:
            return {
                "success": False,
                "message": "Se requiere shipment_id para este tipo de documento.",
            }

        shipment = request.env["supplier.shipment"].sudo().browse(self.safe_int(shipment_id))
        if not shipment.exists() or not self.belongs_to_proforma(proforma, shipment=shipment):
            return {"success": False, "message": "Embarque no encontrado o no autorizado."}

        allowed_mime = ["application/pdf"]
        if document_type == "packing_list":
            allowed_mime.extend([
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
                "text/csv",
            ])

        if mime_type and mime_type not in allowed_mime:
            if document_type == "packing_list":
                return {
                    "success": False,
                    "message": "Solo se permiten archivos PDF u hojas de calculo para Packing List.",
                }
            return {"success": False, "message": "Solo se permiten archivos PDF."}

        is_pdf = (
            mime_type == "application/pdf"
            or (file_name and file_name.lower().endswith(".pdf"))
        )

        final_file_data = file_data
        final_dpi = dpi_value

        if is_pdf:
            final_file_data, final_dpi = self.normalize_pdf_for_upload(file_data, dpi_value)
            try:
                file_size = len(base64.b64decode(final_file_data))
            except Exception:
                pass

        try:
            content_hash = hashlib.sha256(base64.b64decode(final_file_data)).hexdigest()
        except Exception:
            content_hash = hashlib.sha256(
                ("%s_%s_%s" % (file_name or "", document_type, file_size or 0)).encode()
            ).hexdigest()

        doc_model = request.env["supplier.shipment.document"].sudo()
        is_duplicate = doc_model.check_duplicate(
            shipment_id=shipment.id,
            proforma_id=None,
            purchase_id=None,
            document_type=document_type,
            upload_token=content_hash,
        )
        if is_duplicate:
            return {
                "success": False,
                "message": "Este archivo ya fue subido anteriormente para este tipo de documento.",
                "is_duplicate": True,
            }

        vals = {
            "shipment_id": shipment.id,
            "document_type": document_type,
            "name": file_name or "documento",
            "file_data": final_file_data,
            "file_size": self.safe_int(file_size, 0),
            "mime_type": mime_type or "",
            "dpi_value": self.safe_int(final_dpi, 0),
            "upload_token": content_hash,
            "notes": notes or "",
        }

        record = doc_model.create(vals)
        return {
            "success": True,
            "document_id": record.id,
            "document": self.serialize_document(record),
            "documents": self.serialize_documents_for_scope(shipment_id=shipment.id),
        }

    def delete_document(self, token, document_id):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token invalido."}

        proforma = self.get_or_create_proforma(access)
        record = request.env["supplier.shipment.document"].sudo().browse(self.safe_int(document_id))
        if not record.exists():
            return {"success": False, "message": "Documento no encontrado."}

        if not record.shipment_id:
            return {"success": False, "message": "Este documento ya no es gestionable desde el portal."}

        shipment = request.env["supplier.shipment"].sudo().browse(record.shipment_id)
        if not shipment.exists() or not self.belongs_to_proforma(proforma, shipment=shipment):
            return {"success": False, "message": "No autorizado."}

        shipment_id = record.shipment_id
        record.unlink()
        return {
            "success": True,
            "documents": self.serialize_documents_for_scope(shipment_id=shipment_id),
        }

    def list_documents(self, token, shipment_id=None):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token invalido."}

        proforma = self.get_or_create_proforma(access)
        if not proforma:
            return {"success": False, "message": "Proforma no encontrada."}

        result = {"global_documents": []}

        if shipment_id:
            shipment = request.env["supplier.shipment"].sudo().browse(self.safe_int(shipment_id))
            if shipment.exists() and self.belongs_to_proforma(proforma, shipment=shipment):
                result["shipment_documents"] = self.serialize_documents_for_scope(shipment_id=shipment.id)

        return {"success": True, **result}

    # =====================================================================
    #  LEGACY upload_file
    # =====================================================================

    def upload_legacy_file(self, token, payload):
        access = self.validate_token(token)
        if not access:
            return {"success": False, "message": "Token invalido."}

        target_model = payload.get("target_model")
        target_id = payload.get("target_id")
        field_name = payload.get("field_name")
        file_data = payload.get("file_data")
        file_name = payload.get("file_name")

        proforma = self.get_or_create_proforma(access)
        if not proforma:
            return {"success": False, "message": "Proforma no encontrada."}

        allowed_models = {
            "supplier.shipment": ["bl_file"],
            "supplier.shipment.invoice": ["file"],
            "supplier.shipment.packing": ["file"],
        }

        if target_model not in allowed_models or field_name not in allowed_models.get(target_model, []):
            return {"success": False, "message": "Modelo o campo no permitido."}

        record = request.env[target_model].sudo().browse(self.safe_int(target_id))
        if not record.exists():
            return {"success": False, "message": "Registro no encontrado."}

        authorized = False
        if target_model == "supplier.shipment":
            authorized = self.belongs_to_proforma(proforma, shipment=record)
        elif target_model == "supplier.shipment.invoice":
            authorized = self.belongs_to_proforma(proforma, invoice=record)
        elif target_model == "supplier.shipment.packing":
            authorized = self.belongs_to_proforma(proforma, packing=record)

        if not authorized:
            return {"success": False, "message": "Registro no autorizado para este token."}

        if not file_data:
            return {"success": False, "message": "No se recibio contenido de archivo."}

        if not file_name:
            file_name = "archivo"

        fname_field = field_name.replace("file", "filename") if "file" in field_name else "%s_name" % field_name
        if field_name == "bl_file":
            fname_field = "bl_filename"

        write_vals = {field_name: file_data}
        if hasattr(record, fname_field):
            write_vals[fname_field] = file_name

        record.write(write_vals)
        return {"success": True}