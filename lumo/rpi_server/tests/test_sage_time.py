"""Lumo reads Sage's time zone, so alarms ring when the phone would."""

import datetime
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from services import reminders, sage_client  # noqa: E402


class SageTimeTests(unittest.TestCase):
    def tearDown(self):
        sage_client.set_timezone(None)

    def test_now_follows_sages_zone_not_the_pis_clock(self):
        sage_client.set_timezone("Asia/Kolkata")
        fixed = datetime.datetime(2026, 10, 1, 3, 30, tzinfo=datetime.timezone.utc)
        with mock.patch.object(sage_client.datetime, "datetime", wraps=datetime.datetime) as dt:
            dt.now.side_effect = lambda tz=None: fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)
            self.assertEqual(sage_client.now_local(), datetime.datetime(2026, 10, 1, 9, 0))

    def test_times_with_an_offset_become_local_wall_time(self):
        sage_client.set_timezone("Asia/Kolkata")
        self.assertEqual(reminders._parse("2026-10-01T03:30:00Z"), datetime.datetime(2026, 10, 1, 9, 0))
        self.assertEqual(reminders._parse("2026-10-01T09:00"), datetime.datetime(2026, 10, 1, 9, 0))

    def test_bad_zone_name_falls_back_quietly(self):
        sage_client.set_timezone("Not/AZone")
        self.assertIsNone(sage_client._tz)


if __name__ == "__main__":
    unittest.main()
