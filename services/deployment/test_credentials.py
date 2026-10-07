import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

specification = importlib.util.spec_from_file_location(
    "generate_credentials", Path(__file__).with_name("generate-credentials.py")
)
generator = importlib.util.module_from_spec(specification)
specification.loader.exec_module(generator)


class CredentialFileTest(unittest.TestCase):
    def test_private_environment_and_exact_values(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "credentials.env"
            generator.create_environment(destination, {"TOKEN": "synthetic", "PORT": "4789"})
            self.assertEqual(destination.read_text(), "TOKEN=synthetic\nPORT=4789\n")
            self.assertEqual(os.stat(destination).st_mode & 0o777, 0o600)

    def test_existing_credentials_are_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "credentials.env"
            destination.write_text("original")
            with self.assertRaises(FileExistsError):
                generator.create_environment(destination, {"TOKEN": "replacement"})
            self.assertEqual(destination.read_text(), "original")


if __name__ == "__main__":
    unittest.main()
