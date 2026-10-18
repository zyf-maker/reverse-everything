import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('browser_notices', Path(__file__).resolve().parents[1] / 'scripts/browser_notices.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NoticeTests(unittest.TestCase):
    def test_rejects_empty_and_sample_credits(self):
        for document in ('', '<div class="product"><span class="title">Sample</span><div class="license"><pre>Sample</pre></div></div>'):
            with self.assertRaisesRegex(ValueError, 'Incomplete/sample'):
                module.convert_credits(document)

    def test_rejects_missing_license_even_with_expected_count(self):
        with self.assertRaisesRegex(ValueError, 'missing license'):
            module.convert_credits('<div class="product"><span class="title">zlib</span></div>')

    def test_preserves_license_text_and_removes_browser_resources(self):
        names = ['BoringSSL', 'zlib', 'ICU', 'libpng'] + [f'Library {i}' for i in range(96)]
        document = '<html><head><link href="chrome://credits/credits.css"></head><body>'
        for name in names:
            document += f'<div class="product"><span class="title">{name}</span><div class="license"><pre>Copyright A &amp; B\nRedistribution permitted.</pre></div></div>'
        document += '<script src="chrome://credits/credits.js"></script></body></html>'
        offline, text, notices = module.convert_credits(document, 100)
        self.assertEqual(len(notices), 100)
        self.assertEqual(text.count('Copyright A & B\nRedistribution permitted.'), 100)
        self.assertNotIn('chrome://', offline)
        self.assertIn('display:block!important', offline)
        with self.assertRaisesRegex(ValueError, 'Incomplete/sample'):
            module.convert_credits(document, 101)


if __name__ == '__main__':
    unittest.main()
