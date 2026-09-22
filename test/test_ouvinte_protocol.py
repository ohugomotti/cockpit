import importlib.util
import io
import json
import sys
from pathlib import Path
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest.mock import patch

sys.dont_write_bytecode = True

SOURCE = Path(__file__).resolve().parents[1] / 'src' / 'assets' / 'ouvinte-parakeet.py'
spec = importlib.util.spec_from_file_location('ouvinte_qa', SOURCE)
listener = importlib.util.module_from_spec(spec)
spec.loader.exec_module(listener)

class OuvinteProtocolTests(unittest.TestCase):
    def test_invalid_json_types_do_not_kill_listener(self):
        output = io.StringIO()
        requests = 'null\n[]\n42\n"texto"\n{"id":"seguinte","pcm":"fixture"}\n'
        with patch.object(listener, 'carregar_modelo', return_value=object()), patch.object(listener, 'ler_pcm', return_value=[]), patch.object(listener, 'transcrever', return_value='ação 🧪'), patch('sys.stdin', io.StringIO(requests)), redirect_stdout(output):
            self.assertEqual(listener.modo_ouvinte(), 0)
        replies = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(replies[-1], {'id': 'seguinte', 'texto': 'ação 🧪'})

    def test_failed_test_file_returns_failure(self):
        with patch.object(listener, 'carregar_modelo', return_value=object()), patch.object(listener, 'transcrever', return_value=''), patch.object(listener, 'ler_wav', side_effect=OSError('fixture ausente')), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(listener.modo_teste(['inexistente.wav']), 1)

if __name__ == '__main__':
    unittest.main()
