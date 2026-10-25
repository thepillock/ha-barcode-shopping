"""Free barcode lookup sources."""
from __future__ import annotations

import logging
import re
from typing import Any

from aiohttp import ClientError, ClientTimeout

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_USE_UPCITEMDB, DOMAIN

_LOGGER = logging.getLogger(__name__)

UA = "HomeAssistant-BarcodeShopping/0.1 (custom integration)"
TIMEOUT = ClientTimeout(total=8)

# Same open API, different product databases. Searched in this order.
OPEN_FACTS = (
    ("Open Food Facts", "world.openfoodfacts.org"),
    ("Open Products Facts", "world.openproductsfacts.org"),
    ("Open Beauty Facts", "world.openbeautyfacts.org"),
    ("Open Pet Food Facts", "world.openpetfoodfacts.org"),
)


def clean(raw: str | None) -> str | None:
    """Return digits only if it looks like a retail barcode (EAN/UPC)."""
    code = re.sub(r"\D", "", raw or "")
    return code if len(code) in (8, 12, 13, 14) else None


def _title(name: str, brand: str | None) -> str:
    name = " ".join(name.split())
    if brand and brand.lower() not in name.lower():
        return f"{brand} {name}"
    return name


def _result(code, name, brand, quantity, image, source) -> dict[str, Any]:
    return {
        "barcode": code,
        "name": _title(name, brand),
        "brand": brand or None,
        "quantity": quantity or None,
        "image": image or None,
        "source": source,
    }


async def _open_facts(session, source: str, host: str, code: str):
    query = "0" + code if len(code) == 12 else code
    try:
        async with session.get(
            f"https://{host}/api/v2/product/{query}.json",
            params={"fields": "product_name,generic_name,brands,quantity,image_front_small_url"},
            headers={"User-Agent": UA},
            timeout=TIMEOUT,
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json(content_type=None)
    except (ClientError, TimeoutError, ValueError) as err:
        _LOGGER.debug("%s lookup failed: %s", source, err)
        return None
    if data.get("status") != 1:
        return None
    prod = data.get("product") or {}
    name = prod.get("product_name") or prod.get("generic_name")
    if not name:
        return None
    brand = (prod.get("brands") or "").split(",")[0].strip()
    return _result(code, name, brand, prod.get("quantity"), prod.get("image_front_small_url"), source)


async def _upcitemdb(session, code: str):
    """UPCitemdb free trial endpoint: no key, ~100 lookups/day per IP."""
    try:
        async with session.get(
            "https://api.upcitemdb.com/prod/trial/lookup",
            params={"upc": code},
            headers={"User-Agent": UA},
            timeout=TIMEOUT,
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json(content_type=None)
    except (ClientError, TimeoutError, ValueError) as err:
        _LOGGER.debug("UPCitemdb lookup failed: %s", err)
        return None
    items = data.get("items") or []
    if not items or not items[0].get("title"):
        return None
    item = items[0]
    images = item.get("images") or []
    image = images[0] if images and images[0].startswith("https://") else None
    return _result(code, item["title"], item.get("brand"), item.get("size"), image, "UPCitemdb")


async def async_lookup(hass: HomeAssistant, raw: str) -> dict[str, Any] | None:
    """Look up a barcode. Your own saved names win, then the free databases."""
    code = clean(raw)
    if not code:
        return None
    data = hass.data[DOMAIN]
    if code in data["custom"]:
        return _result(code, data["custom"][code], None, None, None, "Saved by you")

    session = async_get_clientsession(hass)
    for source, host in OPEN_FACTS:
        if result := await _open_facts(session, source, host, code):
            return result

    entries = hass.config_entries.async_entries(DOMAIN)
    use_upc = entries[0].options.get(CONF_USE_UPCITEMDB, True) if entries else True
    if use_upc:
        return await _upcitemdb(session, code)
    return None
