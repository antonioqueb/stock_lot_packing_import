(function () {
    "use strict";

    const M = window.SupplierPortalModules;

    M.utils.jsonRpc = function jsonRpc(url, params) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "call",
                params,
                id: Math.floor(Math.random() * 99999),
            }),
        }).then(r => {
            if (!r.ok) {
                throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            }
            return r.json();
        }).then(d => {
            if (d.error) {
                const msg = d.error.data?.message || d.error.message || 'RPC Error';
                throw new Error(msg);
            }
            return d.result;
        });
    };

    M.utils.esc = function esc(s) {
        if (s === null || s === undefined) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    };

    M.utils.asInt = function asInt(v) {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : 0;
    };

    M.utils.readFileAsBase64 = function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve({
                name: file.name,
                data: e.target.result.split(',')[1],
            });
            reader.onerror = () => reject(new Error('File read failed'));
            reader.readAsDataURL(file);
        });
    };
})();