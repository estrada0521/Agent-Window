from __future__ import annotations

import json


KATEX_VERSION = "0.16.11"

RESOURCES = {
    "marked": {
        "url": "https://cdn.jsdelivr.net/npm/marked@18.0.12/lib/marked.umd.min.js",
        "integrity": "sha384-syBWa4ZH5K40lEf03NSGrpgNa4K6VybtlEru+KpBmLBrPb8l304sb82KiBTjMEJS",
    },
    "dompurify": {
        "url": "https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js",
        "integrity": "sha384-a7SzOxErzJ3ZpQz0zJ32d67dSitNzPcbfybc/ykU9KJhMgZkwqfSxlhhdJRS+XGL",
    },
    "katex_css": {
        "url": f"https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/dist/katex.min.css",
        "integrity": "sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+",
    },
    "katex": {
        "url": f"https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/dist/katex.min.js",
        "integrity": "sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg",
    },
    "katex_auto": {
        "url": f"https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/dist/contrib/auto-render.min.js",
        "integrity": "sha384-43gviWU0YVjaDtb/GhzOouOXtZMP/7XUzwPTstBeZFe/+rCMvRwr4yROQP43s0Xk",
    },
    "highlight": {
        "url": "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js",
        "integrity": "sha384-RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU",
    },
}


def resource_tag(name: str, *, defer: bool = False) -> str:
    resource = RESOURCES[name]
    attrs = f'integrity="{resource["integrity"]}" crossorigin="anonymous"'
    if resource["url"].endswith(".css"):
        return f'<link rel="stylesheet" href="{resource["url"]}" {attrs}>'
    return f'<script src="{resource["url"]}" {attrs}{" defer" if defer else ""}></script>'


def resource_config_script() -> str:
    config = json.dumps(RESOURCES, ensure_ascii=True).replace("<", "\\u003c")
    return f'<script>window.cdnResources={config};</script>'
