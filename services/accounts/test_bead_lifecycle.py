"""New lifecycle fields cannot be invalidated by older workspace clients."""
import copy
import unittest
from services.sync.server import validate_update


class BeadLifecycleWireTests(unittest.TestCase):
    def document(self):
        return {"version": 1, "activeId": "", "works": [{
            "id": "00000000-0000-4000-8000-000000000001", "archived": True,
            "deletedAt": "2026-10-11T00:00:00Z", "deletedFromArchive": False,
            "versions": [{"pattern": {"cells": [0, -1]}, "completedCells": [0]}],
        }]}

    def update(self, document):
        return {"protocol": 1, "vaultId": "fixture", "expectedRevision": 0,
                "records": {"tideplan.bead-works.v1": document}}

    def test_recovery_fields_empty_and_purged_documents_roundtrip_without_changing_legacy_routes(self):
        document = self.document()
        self.assertIn("deletedAt", validate_update(self.update(document), allow_bead_works=True))
        purged = {"version": 1, "activeId": "", "works": [], "purgedWorkIds": [document["works"][0]["id"]]}
        self.assertIn("purgedWorkIds", validate_update(self.update(purged), allow_bead_works=True))
        with self.assertRaises(ValueError):
            validate_update(self.update(document))

    def test_old_archive_restore_cannot_flip_a_deleted_work_to_live_without_clearing_metadata(self):
        document = self.document(); document["works"][0]["archived"] = False
        document["activeId"] = document["works"][0]["id"]
        with self.assertRaises(ValueError):
            validate_update(self.update(document), allow_bead_works=True)
        del document["works"][0]["deletedAt"]; del document["works"][0]["deletedFromArchive"]
        validate_update(self.update(document), allow_bead_works=True)

    def test_corrupt_recovery_progress_and_purged_collisions_are_rejected(self):
        source = self.document()
        for marks in ([1], [0, 0], [True], [-1], [2], "bad"):
            document = copy.deepcopy(source); document["works"][0]["versions"][0]["completedCells"] = marks
            with self.assertRaises(ValueError):
                validate_update(self.update(document), allow_bead_works=True)
        for stamp in (None, "invalid", "2026-10-11T00:00:00"):
            document = copy.deepcopy(source); document["works"][0]["deletedAt"] = stamp
            with self.assertRaises(ValueError):
                validate_update(self.update(document), allow_bead_works=True)
        document = copy.deepcopy(source); document["purgedWorkIds"] = [source["works"][0]["id"]]
        with self.assertRaises(ValueError):
            validate_update(self.update(document), allow_bead_works=True)


if __name__ == "__main__":
    unittest.main()
