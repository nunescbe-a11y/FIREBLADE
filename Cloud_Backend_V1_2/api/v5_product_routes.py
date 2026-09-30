"""Fireblade V5 product-search routes.

This module is intentionally limited to published-product search/detail. WhatsApp
routes remain out of this integration stage and are added separately later.
"""
from __future__ import annotations

import os
import secrets
from typing import Optional

from fastapi import Header, HTTPException

from api.product_intelligence import product_detail, search_products


def _internal_authorize(value: Optional[str]) -> None:
    expected = os.environ.get("FIREBLADE_INTERNAL_API_KEY", "").strip()
    if not expected:
        raise HTTPException(503, "Fireblade internal API key is not configured")
    supplied = (value or "").strip()
    if not supplied or not secrets.compare_digest(supplied, expected):
        raise HTTPException(401, "Invalid Fireblade internal API key")


def install_v5_product_routes(app, db):
    @app.get("/api/v5/products/search")
    def product_search(
        q: str,
        limit: int = 8,
        x_fireblade_internal_key: Optional[str] = Header(default=None),
        x_fireblade_actor: Optional[str] = Header(default=None),
    ):
        _internal_authorize(x_fireblade_internal_key)
        actor = (x_fireblade_actor or "unknown")[:120]
        return {"candidates": search_products(db, q, limit, actor=actor)}

    @app.get("/api/v5/products/{product_id}")
    def product_get(
        product_id: str,
        x_fireblade_internal_key: Optional[str] = Header(default=None),
    ):
        _internal_authorize(x_fireblade_internal_key)
        return product_detail(db, product_id)
