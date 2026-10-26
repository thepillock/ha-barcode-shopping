# Barcode Shopping for Home Assistant

Scan a barcode with your phone camera, look the product up in free databases, and add it to the built-in Shopping List.
Developed with Claude because something in HomeAssistant changed and beepbasket no longer works.



## Install
1. Install this repo:
   - Copy `custom_components/barcode_shopping` into your HA `config/custom_components/`,  
   **or**
   - Set up a custom repository of type Intgration in HACS using https://github.com/thepillock/ha-barcode-shopping 
2. Make sure the **Shopping List** integration is set up - this is a core Home Assistant integration
3. Restart HA, and then hard refresh your browser just in case. This seem to solve so many Home Assistant issues.
4. Once restarted, go to Settings > Devices & services > Add integration > **Barcode Shopping**.
5. Tick the box to use UPCitemdb for lookups - this leverages the free tier and is limited to 100 requests per day

   <img width="400" alt="image" src="https://github.com/user-attachments/assets/86d4e6d0-f358-4d59-93f9-9548030c698d" />

6. The integration is now active.


## Setup

1. Edit an existing dashboard, or create a new one.
2. Add Barcode Shopping from the visual picker.
3. Save the dashboard

I decided a simple portrait dashboard with Barcode Shopping at the top and the shopping list itself below worked well on a phone

<img width="300" alt="image" src="https://github.com/user-attachments/assets/77efb9c0-2532-4b6e-a0e2-c2c81d0937f6" />

## Usage
  
4. Open the dashboard you made
5. Click "Start Camera"
6. Scan something
   - If the item is recognised (see Lookup Order in Notes, below) then it appears and you can tap **Add to Shopping List**. This, as you may guess, adds it to your regular Home Assistant shopping list. If it was found in one of the online databases, an image will be displayed.
   - If the item is not recognised, it asks you to name it and will remember this for next time
   - If you scan something but feel instant regret and don't want to add it, tap "Scan Again" - this discards the last item and reopens the camera.
7. You can also type in the digits from a barcode if it won't scan for whatever reason


## Notes

### Lookup order
1. Names you saved yourself (unknown barcodes you typed a name for)
2. Open Food Facts, Open Products Facts, Open Beauty Facts, Open Pet Food Facts (free, no key)
3. UPCitemdb free tier (optional, about 100 lookups/day)

### The camera needs HTTPS
Browsers only give web pages camera access on a secure (HTTPS) page. **This applies to the Home Assistant companion app too.** If the app is using a plain `http://` address (common as the "internal URL" on a home network), you will see "Camera not available".

- Open Home Assistant over an `https://` address (Nabu Casa, a reverse proxy, or a local certificate).
- In the companion app, check Settings > Companion app > your server, and make sure the internal URL also starts with `https://`.
- Chrome on Android uses the built-in barcode detector. Safari and iOS fall back to the ZXing library, loaded from jsDelivr, so the phone needs internet access.

### YAML-mode dashboards
The integration adds the card to your dashboard resources automatically, but only for dashboards you manage through the UI. If you use YAML mode (`lovelace: mode: yaml` in `configuration.yaml`), Home Assistant treats resources as read-only config, so add the resource yourself:

```yaml
lovelace:
  mode: yaml
  resources:
    - url: /barcode_shopping/barcode-shopping-card.js
      type: module
```

Restart Home Assistant afterwards. The card is also loaded through a fallback script injection, but that can arrive late, so the explicit resource is more reliable. YAML dashboards have no card picker, so add the card by hand with `type: custom:barcode-shopping-card`.

### Android/iPhone Scanner

- Chrome/Android uses the native BarcodeDetector. Safari/iOS falls back to ZXing, loaded from jsDelivr, so the phone needs internet.

### Service (for automations, NFC tags, etc.)
`barcode_shopping.add` with `barcode`, optional `name`, optional `remember`.

## Initial Release
Tested on Android / HomeAssistant 2026.10.4
