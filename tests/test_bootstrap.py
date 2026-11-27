import shutil
from pathlib import Path

from jarvis.bootstrap import pick_model_for_hardware, set_config_model

ROOT = Path(__file__).resolve().parents[1]


def test_pick_model_scales_with_vram():
    assert pick_model_for_hardware(24) == "qwen2.5:14b"
    assert pick_model_for_hardware(8) == "qwen2.5:7b"
    assert pick_model_for_hardware(4) == "qwen2.5:3b"
    assert pick_model_for_hardware(None, 8) == "qwen2.5:1.5b"
    assert pick_model_for_hardware(None, 32) == "qwen2.5:3b"


def test_set_config_model_only_touches_model_section(tmp_path):
    cfg = tmp_path / "config.yaml"
    shutil.copy(ROOT / "config.yaml", cfg)
    before = cfg.read_text(encoding="utf-8").splitlines()
    assert set_config_model("qwen2.5:7b", cfg)
    after = cfg.read_text(encoding="utf-8").splitlines()
    changed = [(a, b) for a, b in zip(before, after) if a != b]
    assert len(before) == len(after)
    assert len(changed) == 1 and changed[0][1].strip() == "model: qwen2.5:7b"
    import yaml
    assert yaml.safe_load(cfg.read_text(encoding="utf-8"))["model"]["model"] == "qwen2.5:7b"
