"""Scan barcodes and add the products to the Home Assistant shopping list."""
from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from . import lookup
from .const import CARD_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

ADD_SCHEMA = vol.Schema(
    {
        vol.Required("barcode"): cv.string,
        vol.Optional("name"): cv.string,
        vol.Optional("remember", default=False): cv.boolean,
    }
)


async def _async_register_resource(hass: HomeAssistant, url: str) -> None:
    """Register the card as a Lovelace resource (storage-mode dashboards)."""
    lovelace = hass.data.get("lovelace")
    resources = getattr(lovelace, "resources", None)
    if resources is None and isinstance(lovelace, dict):
        resources = lovelace.get("resources")
    if resources is None or not hasattr(resources, "async_create_item"):
        return  # YAML-mode dashboards: add_extra_js_url covers these
    try:
        if not getattr(resources, "loaded", True):
            await resources.async_load()
            resources.loaded = True
        data = {"res_type": "module", "url": url}
        existing = [
            item
            for item in resources.async_items()
            if item.get("url", "").split("?")[0] == CARD_URL
        ]
        if not existing:
            await resources.async_create_item(data)
        elif existing[0]["url"] != url:
            await resources.async_update_item(existing[0]["id"], data)
    except Exception:  # noqa: BLE001
        _LOGGER.warning("Could not register the card as a Lovelace resource", exc_info=True)


@websocket_api.websocket_command(
    {vol.Required("type"): "barcode_shopping/lookup", vol.Required("barcode"): str}
)
@websocket_api.async_response
async def ws_lookup(hass: HomeAssistant, connection, msg: dict) -> None:
    """Look up a barcode for the card."""
    connection.send_result(msg["id"], await lookup.async_lookup(hass, msg["barcode"]))


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up services, websocket API and the card (once)."""
    store = Store(hass, 1, f"{DOMAIN}.custom")
    hass.data[DOMAIN] = {"store": store, "custom": await store.async_load() or {}}

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                CARD_URL,
                str(Path(__file__).parent / "www" / "barcode-shopping-card.js"),
                False,
            )
        ]
    )
    integration = await async_get_integration(hass, DOMAIN)
    url = f"{CARD_URL}?v={integration.version}"
    # frontend.add_extra_js_url(hass, url)

    async def _register(hass: HomeAssistant) -> None:
        await _async_register_resource(hass, url)

    async_at_started(hass, _register)
    websocket_api.async_register_command(hass, ws_lookup)

    async def handle_add(call: ServiceCall) -> None:
        raw = call.data["barcode"]
        name = call.data.get("name")
        if not name:
            result = await lookup.async_lookup(hass, raw)
            if not result:
                raise ServiceValidationError(f"No product found for barcode {raw}")
            name = result["name"]
        elif call.data["remember"] and (code := lookup.clean(raw)):
            data = hass.data[DOMAIN]
            data["custom"][code] = name
            await data["store"].async_save(data["custom"])
        await hass.services.async_call(
            "shopping_list", "add_item", {"name": name}, blocking=True
        )

    hass.services.async_register(DOMAIN, "add", handle_add, schema=ADD_SCHEMA)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return True
