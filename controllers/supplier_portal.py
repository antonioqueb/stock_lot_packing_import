# -*- coding: utf-8 -*-

from odoo import http

from ..services.supplier_portal_base import SupplierPortalBaseService
from ..services.supplier_portal_documents import SupplierPortalDocumentsService
from ..services.supplier_portal_proforma import SupplierPortalProformaService


class SupplierPortalController(http.Controller):

    def __init__(self):
        super().__init__()
        self.base_service = SupplierPortalBaseService()
        self.documents_service = SupplierPortalDocumentsService()
        self.proforma_service = SupplierPortalProformaService()

    # =====================================================================
    #  VIEW
    # =====================================================================

    @http.route("/supplier/pl/<string:token>", type="http", auth="public", website=True, sitemap=False)
    def view_supplier_portal(self, token, **kwargs):
        return self.proforma_service.build_portal_view(token)

    # =====================================================================
    #  GLOBALS
    # =====================================================================

    @http.route("/supplier/api/v2/save_globals", type="jsonrpc", auth="public", csrf=False)
    def api_save_globals(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.save_globals(
            params.get("token"),
            params.get("globals_data"),
        )

    # =====================================================================
    #  SHIPMENTS
    # =====================================================================

    @http.route("/supplier/api/v2/create_shipment", type="jsonrpc", auth="public", csrf=False)
    def api_create_shipment(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.create_shipment(
            params.get("token"),
            params.get("shipment_data"),
        )

    @http.route("/supplier/api/v2/update_shipment", type="jsonrpc", auth="public", csrf=False)
    def api_update_shipment(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.update_shipment(
            params.get("token"),
            params.get("shipment_id"),
            params.get("shipment_data"),
        )

    @http.route("/supplier/api/v2/delete_shipment", type="jsonrpc", auth="public", csrf=False)
    def api_delete_shipment(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.delete_shipment(
            params.get("token"),
            params.get("shipment_id"),
        )

    # =====================================================================
    #  CONTAINERS
    # =====================================================================

    @http.route("/supplier/api/v2/save_containers", type="jsonrpc", auth="public", csrf=False)
    def api_save_containers(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.save_containers(
            params.get("token"),
            params.get("shipment_id"),
            params.get("containers"),
        )

    # =====================================================================
    #  INVOICES
    # =====================================================================

    @http.route("/supplier/api/v2/save_invoices", type="jsonrpc", auth="public", csrf=False)
    def api_save_invoices(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.save_invoices(
            params.get("token"),
            params.get("shipment_id"),
            params.get("invoices"),
        )

    # =====================================================================
    #  PACKINGS
    # =====================================================================

    @http.route("/supplier/api/v2/save_packing", type="jsonrpc", auth="public", csrf=False)
    def api_save_packing(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.save_packing(
            params.get("token"),
            params.get("shipment_id"),
            params.get("packing_data"),
            params.get("rows"),
        )

    @http.route("/supplier/api/v2/delete_packing", type="jsonrpc", auth="public", csrf=False)
    def api_delete_packing(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.delete_packing(
            params.get("token"),
            params.get("packing_id"),
        )

    # =====================================================================
    #  LEGACY upload_file
    # =====================================================================

    @http.route("/supplier/api/v2/upload_file", type="jsonrpc", auth="public", csrf=False)
    def api_upload_file(self, **kw):
        params = self.base_service.get_params()
        return self.documents_service.upload_legacy_file(
            params.get("token"),
            params,
        )

    # =====================================================================
    #  DOCUMENTOS
    # =====================================================================

    @http.route("/supplier/api/v2/upload_document", type="jsonrpc", auth="public", csrf=False)
    def api_upload_document(self, **kw):
        params = self.base_service.get_params()
        return self.documents_service.upload_document(
            params.get("token"),
            params,
        )

    @http.route("/supplier/api/v2/delete_document", type="jsonrpc", auth="public", csrf=False)
    def api_delete_document(self, **kw):
        params = self.base_service.get_params()
        return self.documents_service.delete_document(
            params.get("token"),
            params.get("document_id"),
        )

    @http.route("/supplier/api/v2/list_documents", type="jsonrpc", auth="public", csrf=False)
    def api_list_documents(self, **kw):
        params = self.base_service.get_params()
        result = self.documents_service.list_documents(
            params.get("token"),
            params.get("shipment_id"),
        )

        # agregar progreso aquí para mantener compatibilidad
        if result.get("success"):
            access = self.base_service.validate_token(params.get("token"))
            if access:
                proforma = self.base_service.get_or_create_proforma(access)
                if proforma:
                    result["progress"] = self.proforma_service.compute_progress(proforma)

        return result

    # =====================================================================
    #  COMPLETE / RELOAD
    # =====================================================================

    @http.route("/supplier/api/v2/complete", type="jsonrpc", auth="public", csrf=False)
    def api_complete(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.complete_proforma(
            params.get("token"),
        )

    @http.route("/supplier/api/v2/reload", type="jsonrpc", auth="public", csrf=False)
    def api_reload(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.reload_proforma(
            params.get("token"),
        )

    # =====================================================================
    #  ROW IMAGES
    # =====================================================================

    @http.route("/supplier/api/v2/upload_row_image", type="jsonrpc", auth="public", csrf=False)
    def api_upload_row_image(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.upload_row_image(
            params.get("token"),
            params.get("row_id"),
            params.get("image_data"),
            params.get("image_name"),
        )

    @http.route("/supplier/api/v2/delete_row_image", type="jsonrpc", auth="public", csrf=False)
    def api_delete_row_image(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.delete_row_image(
            params.get("token"),
            params.get("row_id"),
        )

    # =====================================================================
    #  BLOCK IMAGES
    # =====================================================================

    @http.route("/supplier/api/v2/upload_block_image", type="jsonrpc", auth="public", csrf=False)
    def api_upload_block_image(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.upload_block_image(
            params.get("token"),
            params.get("shipment_id"),
            params.get("block_name"),
            params.get("product_id"),
            params.get("image_data"),
            params.get("image_name"),
        )

    @http.route("/supplier/api/v2/delete_block_image", type="jsonrpc", auth="public", csrf=False)
    def api_delete_block_image(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.delete_block_image(
            params.get("token"),
            params.get("block_image_id"),
        )

    @http.route("/supplier/api/v2/get_block_images", type="jsonrpc", auth="public", csrf=False)
    def api_get_block_images(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.get_block_images(
            params.get("token"),
            params.get("shipment_id"),
        )

    # =====================================================================
    #  LEGACY submit
    # =====================================================================

    @http.route("/supplier/pl/submit", type="jsonrpc", auth="public", csrf=False)
    def submit_pl_data(self, **kw):
        params = self.base_service.get_params()
        return self.proforma_service.submit_legacy_pl_data(
            params.get("token"),
            params.get("rows"),
            params.get("header"),
            params.get("files"),
        )