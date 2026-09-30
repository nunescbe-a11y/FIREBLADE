"""Fireblade V5 product search helpers.

This module is designed to plug into the existing FastAPI backend's `_supabase`
callback. It never returns unpublished or unverified products.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional
from urllib.parse import quote

from fastapi import HTTPException


def normalize_query(value: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def embedding_for_query(text: str) -> Optional[list[float]]:
    """Return an embedding or None when semantic search is intentionally disabled.

    Uses the standard OpenAI /v1/embeddings endpoint when OPENAI_API_KEY is set.
    FIREBLADE_EMBEDDING_MODEL defaults to text-embedding-3-small, which produces
    the 1536-dimensional vector expected by the V5 migration.
    """
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        return None
    model = os.environ.get("FIREBLADE_EMBEDDING_MODEL", "text-embedding-3-small").strip()
    payload = json.dumps({"model": model, "input": text}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=payload,
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(502, f"Embedding provider HTTP {exc.code}: {detail[:500]}")
    except Exception as exc:
        raise HTTPException(502, f"Embedding provider unavailable: {exc}")
    try:
        vector = body["data"][0]["embedding"]
        if len(vector) != 1536:
            raise ValueError(f"expected 1536 dimensions, got {len(vector)}")
        return [float(x) for x in vector]
    except Exception as exc:
        raise HTTPException(502, f"Invalid embedding response: {exc}")


def search_products(db, query: str, limit: int = 8, actor: str = "unknown") -> list[dict[str, Any]]:
    query = (query or "").strip()
    if len(query) < 2:
        return []
    if len(query) > 180:
        raise HTTPException(400, "Product search is too long")
    limit = max(1, min(int(limit or 8), 20))
    embedding = embedding_for_query(query)
    vector_arg = None if embedding is None else "[" + ",".join(f"{x:.9g}" for x in embedding) + "]"
    _, rows = db("POST", "rpc/fireblade_search_products", {
        "p_query": query,
        "p_query_embedding": vector_arg,
        "p_limit": limit,
    })
    rows = rows or []
    normalized = normalize_query(query)
    # Search audit is intentionally best-effort; a logging failure must not hide
    # a valid product result from the marketing user.
    try:
        db("POST", "fireblade_product_search_audit", {
            "actor": actor,
            "query_text": query,
            "normalized_query": normalized,
            "returned_candidates": [
                {
                    "product_id": r.get("product_id"),
                    "product_code": r.get("product_code"),
                    "name": r.get("canonical_name"),
                    "score": r.get("final_score"),
                    "reason": r.get("match_reason"),
                }
                for r in rows
            ],
        }, "return=minimal")
    except Exception:
        pass
    return rows


def product_detail(db, product_id: str) -> dict[str, Any]:
    pid = quote(product_id, safe="")
    _, products = db(
        "GET",
        "fireblade_products?select=id,product_code,canonical_name,brand,manufacturer,category,subcategory,"
        f"lifecycle_status,publish_status,verification_status,current_revision_id&id=eq.{pid}&limit=1",
    )
    if not products:
        raise HTTPException(404, "Product not found")
    product = products[0]
    if product.get("publish_status") != "PUBLISHED" or product.get("verification_status") != "VERIFIED":
        raise HTTPException(409, "Product is not approved for customer use")
    if product.get("lifecycle_status") != "ACTIVE":
        raise HTTPException(409, "Product is not active")

    _, variants = db(
        "GET",
        f"fireblade_product_variants?select=*&product_id=eq.{pid}&status=eq.ACTIVE&verified=eq.true&order=model_code.asc",
    )
    _, specs = db(
        "GET",
        f"fireblade_product_specs?select=id,variant_id,spec_key,spec_label,value_text,numeric_value,unit,customer_priority,source_chunk_id"
        f"&product_id=eq.{pid}&active=eq.true&verification_status=eq.VERIFIED&order=customer_priority.desc,spec_label.asc",
    )
    _, prices = db(
        "GET",
        f"fireblade_product_prices?select=id,variant_id,amount,currency,quantity_min,quantity_max,tax_note,commercial_note,effective_from,effective_until"
        f"&product_id=eq.{pid}&active=eq.true&verification_status=eq.VERIFIED&order=effective_from.desc.nullslast,created_at.desc",
    )
    _, assets = db(
        "GET",
        f"fireblade_product_assets?select=id,variant_id,asset_type,title,storage_bucket,storage_object_path,sha256,revision_label,revision_date"
        f"&product_id=eq.{pid}&active=eq.true&verification_status=eq.VERIFIED&customer_sendable=eq.true&order=asset_type.asc,created_at.desc",
    )
    revision = None
    if product.get("current_revision_id"):
        rid = quote(product["current_revision_id"], safe="")
        _, revisions = db("GET", f"fireblade_product_revisions?select=*&id=eq.{rid}&limit=1")
        revision = revisions[0] if revisions else None

    return {
        "product": product,
        "revision": revision,
        "variants": variants or [],
        "specs": specs or [],
        "prices": prices or [],
        "assets": assets or [],
    }
