# -*- coding: utf-8 -*-
"""Penglai-layer redaction for GA LLM prompt/response logs.

GenericAgent owns `llmcore._write_llm_log`; Penglai keeps that upstream file
unchanged and mounts this wrapper at plugin load time.
"""
import sys

import llmcore
from penglai_runtime.redaction import redact_text


if not getattr(llmcore._write_llm_log, "_penglai_logguard", False):
    _orig_write_llm_log = llmcore._write_llm_log

    def _guarded_write_llm_log(label, content, log_path=None, model=""):
        try:
            content = redact_text(content)
        except Exception:
            pass
        return _orig_write_llm_log(label, content, log_path=log_path, model=model)

    _guarded_write_llm_log._penglai_logguard = True
    _guarded_write_llm_log._penglai_orig = _orig_write_llm_log
    llmcore._write_llm_log = _guarded_write_llm_log
    sys.stderr.write("[penglai_logguard] LLM 日志脱敏已挂载（llmcore._write_llm_log）\n")
