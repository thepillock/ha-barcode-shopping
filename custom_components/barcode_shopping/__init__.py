"""Scan barcodes and add the products to the Home Assistant shopping list."""
from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.helpers.storage import Store

from . import lookup
from .const import CARD_URL, DOMAIN, VERSION

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

ADD_SCHEMA = vol.Schema(
    {
        vol.Required("barcode"): cv.string,
        vol.Optional("name"): cv.string,
        vol.Optional("remember", default=False): cv.boolean,
    }
)


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
    frontend.add_extra_js_url(hass, f"{CARD_URL}?v={VERSION}")
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
