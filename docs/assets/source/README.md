# Source art

Master artwork that shipped assets are derived from. These files are not referenced by the docs.

| Source | Derived asset | Derivation |
| --- | --- | --- |
| `skill-loom-logo-master.png` (1254×1254) | [`../skill-loom-logo.png`](../skill-loom-logo.png) (280×280) | Resized to 2× the 140 px display size, quantized to 256 colors. |

Regenerate the derived logo with:

```sh
python3 -c "
from PIL import Image
im = Image.open('docs/assets/source/skill-loom-logo-master.png').convert('RGB')
im.resize((280, 280), Image.LANCZOS).quantize(
    colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG
).save('docs/assets/skill-loom-logo.png', optimize=True)
"
```
