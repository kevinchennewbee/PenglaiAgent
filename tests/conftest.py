# -*- coding: utf-8 -*-
import sys

import pytest


@pytest.fixture(autouse=True)
def restore_test_module_patches():
    """Keep script-style plugin tests from leaking fake core modules into pytest."""
    names = (
        "agent_loop",
        "ga",
        "plugins.hooks",
        "requests",
        "requests.compat",
        "mykey",
    )
    originals = {name: sys.modules.get(name) for name in names}
    yield
    for name, module in originals.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module
