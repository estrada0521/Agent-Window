from __future__ import annotations

import re
import unicodedata


def workspace_slug_variants(path_value: str, *, include_lower: bool = False) -> list[str]:
    raw_slug = str(path_value or "").replace("/", "-").lstrip("-")
    if not raw_slug:
        return []
    variants: list[str] = []
    seen: set[str] = set()
    source_values: list[str] = []
    for candidate in (
        raw_slug,
        unicodedata.normalize("NFC", raw_slug),
        unicodedata.normalize("NFKC", raw_slug),
    ):
        if candidate not in source_values:
            source_values.append(candidate)
    for source in source_values:
        for candidate in (
            source,
            source.replace("_", "-"),
            re.sub(r"[^A-Za-z0-9.-]+", "-", source),
            re.sub(r"[^A-Za-z0-9.-]", "-", source),
            re.sub(r"[^A-Za-z0-9-]+", "-", source),
            re.sub(r"[^A-Za-z0-9-]", "-", source),
        ):
            trimmed = candidate.strip("-")
            compacted = re.sub(r"-+", "-", candidate).strip("-")
            for normalized in (trimmed, compacted):
                if not normalized:
                    continue
                outputs = (normalized, normalized.lower()) if include_lower else (normalized,)
                for output in outputs:
                    if output and output not in seen:
                        seen.add(output)
                        variants.append(output)
    return variants
