# -*- coding: utf-8 -*-
from memory import adb_ui


def test_adb_ui_parses_normal_bounded_hierarchy():
    nodes = adb_ui._parse_xml(
        '<hierarchy><node text="Open" clickable="true" bounds="[0,0][10,20]" /></hierarchy>',
        raw=True,
    )
    assert nodes[0]["text"] == "Open"
    assert nodes[0]["cx"] == 5


def test_adb_ui_rejects_dtd_and_entities():
    payload = '<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]><hierarchy>&leak;</hierarchy>'
    try:
        adb_ui._parse_xml(payload, raw=True)
        raise AssertionError("DTD/entity XML was accepted")
    except (ValueError, Exception) as exc:
        assert "DTD" in str(exc) or "EntitiesForbidden" in type(exc).__name__
