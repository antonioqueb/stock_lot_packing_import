(function () {
    "use strict";

    const M = window.SupplierPortalModules || {};

    // PORTAL-REDESIGN-003:
    // El bootstrap ahora usa la nueva app visual. Si por alguna razón no carga,
    // se conserva fallback al portal legacy para evitar dejar al proveedor sin acceso.
    if (M.ModernSupplierPortal) {
        window.supplierPortal = new M.ModernSupplierPortal();
    } else if (M.SupplierPortal) {
        console.warn("[Portal] ModernSupplierPortal no disponible. Usando SupplierPortal legacy.");
        window.supplierPortal = new M.SupplierPortal();
    } else {
        console.error("[Portal] No se encontró implementación de portal.");
    }
})();
