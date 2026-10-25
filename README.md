# Barcode Shopping for Home Assistant

Scan a barcode with your phone camera, look the product up in free databases, and add it to the built-in Shopping List.
Developed with Claude because something in HomeAssistant changed and beepbasket no longer works.

## Install
1. Copy `custom_components/barcode_shopping` into your HA `config/custom_components/` (or add this repo to HACS as a custom repository).
2. Make sure the **Shopping List** integration is set up.
3. Restart HA, then Settings > Devices & services > Add integration > **Barcode Shopping**.
4. Hard-refresh your browser. Add the card:

```yaml
type: custom:barcode-shopping-card
title: Scan to shopping list
auto_add: false   # true = add found items instantly and keep scanning
```

## Lookup order
1. Names you saved yourself (unknown barcodes you typed a name for)
2. Open Food Facts, Open Products Facts, Open Beauty Facts, Open Pet Food Facts (free, no key)
3. UPCitemdb free tier (optional, about 100 lookups/day)

## Camera requirements
- Browsers only allow the camera over **HTTPS** (Nabu Casa, reverse proxy, etc.) or in the **HA companion app** (grant camera permission).
- Chrome/Android uses the native BarcodeDetector. Safari/iOS falls back to ZXing, loaded from jsDelivr, so the phone needs internet.

## Service (for automations, NFC tags, etc.)
`barcode_shopping.add` with `barcode`, optional `name`, optional `remember`.

## Initial Release
Tested on Android / HomeAssistant 2026.10.1
