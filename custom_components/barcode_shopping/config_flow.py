"""Config flow for Barcode Shopping."""
from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback

from .const import CONF_USE_UPCITEMDB, DOMAIN


def _schema(default: bool) -> vol.Schema:
    return vol.Schema({vol.Required(CONF_USE_UPCITEMDB, default=default): bool})


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Barcode Shopping", data={}, options=user_input)
        return self.async_show_form(step_id="user", data_schema=_schema(True))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return OptionsFlow()


class OptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        current = self.config_entry.options.get(CONF_USE_UPCITEMDB, True)
        return self.async_show_form(step_id="init", data_schema=_schema(current))
