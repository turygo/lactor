# Lactor

Immersive web article reader with synchronized TTS and word-by-word highlighting.

## Quick Start

### Backend

```bash
pip install -e ".[dev]"
lactor serve --port 7890 --extension-id <your-extension-id>
```

### Extension

1. Open `about:debugging#/runtime/this-firefox`
2. Load `extension/manifest.json` as temporary add-on
3. Open extension settings to find your Extension ID
4. Restart backend with `--extension-id <id>` from step 3
5. Click the Lactor icon on any article page

### Development

```bash
lactor serve --port 7890 --dev
pytest tests/ -v
python benchmark/run_all.py --port 7890
```
