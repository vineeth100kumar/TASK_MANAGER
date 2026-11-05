"""The SD card choice: card when mounted and migrated, else the boot-drive copy."""
import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import system_health  # noqa: E402


def load(env, mounted):
    """Import data_dir fresh with a given environment and mount state."""
    sys.modules.pop("data_dir", None)
    with mock.patch.dict(os.environ, env, clear=False), mock.patch("os.path.ismount", return_value=mounted):
        mod = importlib.import_module("data_dir")
        return mod, os.environ.get("SAGE_DB_PATH")


class DataDir(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.card = self.tmp / "card" / "sage_sync.db"
        self.old = self.tmp / "old" / "sage_sync.db"
        self.old.parent.mkdir()
        self.old.write_bytes(b"old")
        self.env = {"SAGE_DATA_MOUNT": str(self.tmp / "card"), "SAGE_DB_PATH": str(self.card),
                    "SAGE_DB_FALLBACK": str(self.old)}

    def tearDown(self):
        sys.modules.pop("data_dir", None)

    def test_nothing_set_changes_nothing(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            for k in ("SAGE_DATA_MOUNT", "SAGE_DB_FALLBACK"):
                os.environ.pop(k, None)
            sys.modules.pop("data_dir", None)
            mod = importlib.import_module("data_dir")
        self.assertEqual(mod.status()["mode"], "plain")

    def test_card_missing_falls_back(self):
        mod, using = load(self.env, mounted=False)
        self.assertEqual(using, str(self.old))
        self.assertEqual(mod.status()["mode"], "fallback")
        self.assertIn("not mounted", mod.status()["reason"])

    def test_card_mounted_but_not_migrated_falls_back(self):
        self.card.parent.mkdir()
        mod, using = load(self.env, mounted=True)
        self.assertEqual(using, str(self.old))
        self.assertIn("migrate_data_to_card", mod.status()["reason"])

    def test_card_mounted_and_migrated_uses_card(self):
        self.card.parent.mkdir()
        self.card.write_bytes(b"new")
        mod, using = load(self.env, mounted=True)
        self.assertEqual(using, str(self.card))
        with mock.patch("os.path.ismount", return_value=True), mock.patch.object(mod, "MOUNT", str(self.card.parent)):
            s = mod.status()
        self.assertEqual(s["mode"], "card")
        self.assertTrue(s["mounted"])
        self.assertIn("freeBytes", s)
        self.assertIn("codeOnCard", s)  # move_system_to_card.sh moved the checkout?

    def test_health_flags_fallback_and_low_space(self):
        base = {"server": {"webApp": True, "auth": True}, "workers": [], "radar": {}, "markets": {},
                "backups": {}, "phone": {}, "clock": {}}
        data = dict(base, storage={"mode": "fallback", "reason": "x is not mounted"})
        self.assertTrue(any("NOT on the SD card" in p for p in system_health.problems(data)))
        data = dict(base, storage={"mode": "card", "mount": "/m", "readOnly": True, "freePercent": 4.0, "freeBytes": 1_000_000_000})
        lines = system_health.problems(data)
        self.assertTrue(any("read-only" in p for p in lines))
        self.assertTrue(any("almost full" in p for p in lines))
        data = dict(base, storage={"mode": "card", "mount": "/m", "freePercent": 90.0, "freeBytes": 50_000_000_000})
        self.assertFalse(any("SD card" in p for p in system_health.problems(data)))


if __name__ == "__main__":
    unittest.main()
