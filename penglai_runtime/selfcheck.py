# -*- coding: utf-8 -*-
"""Self-check CLI for the V5 test runtime."""

import argparse
import json

from . import VERSION
from .flags import runtime_enabled, shadow_enabled


def status():
    return {
        "version": VERSION,
        "runtime_enabled": runtime_enabled(),
        "shadow_enabled": shadow_enabled(),
        "contracts": [
            "InboundEvent",
            "SessionRouter",
            "SessionQueue",
            "DeliveryService",
            "InteractionRequest",
            "TextInteractionAdapter",
            "OutputCleaner",
            "InMemoryIMAdapter",
            "ShadowRecorder",
        ],
        "default_behavior": "wrapper-layer integration; GA core and upstream frontend files stay unchanged",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Penglai Runtime Hub V5 test self-check")
    parser.add_argument("--json", action="store_true", help="print machine-readable status")
    args = parser.parse_args(argv)
    data = status()
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"Penglai Runtime Hub V5 test: {data['version']}")
        print(f"runtime enabled: {data['runtime_enabled']}")
        print(f"shadow enabled: {data['shadow_enabled']}")
        print("contracts: " + ", ".join(data["contracts"]))
        print(data["default_behavior"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
