# -*- coding: utf-8 -*-
"""ouvinte-parakeet.py — ouvinte de voz alternativo do Cockpit.

Motor: NVIDIA Parakeet TDT 0.6B v3 (25 línguas, português incluso), rodando em
CPU pelo pacote `onnx-asr` (onnxruntime), variante int8 (~640 MB em disco).

Fala EXATAMENTE o mesmo protocolo dos ouvintes whisper embutidos no main.js
(constante OUVINTE), então o app conversa com ele sem aprender nada novo:

  stdin  (1 JSON por linha)   {"id": "a1", "pcm": "C:/.../ditado-x-1.pcm", "rapido": true}
                              {"id": "a2", "wav": "C:/.../gravacao.wav"}
  stdout (1 JSON por linha)   {"pronto": true}                 -> modelo carregado, pode mandar
                              {"id": "a1", "texto": "..."}     -> resposta
                              {"id": "a1", "erro": "..."}      -> falhou SO' esse pedido, segue vivo

  "pcm" = arquivo de amostras cruas int16 / 16 kHz / mono escrito pelo app.
  "wav" = caminho de um WAV PCM (16 kHz mono, como o ffmpeg do app gera).
  "rapido" = no whisper escolhe beam 1 x 5. O Parakeet TDT nao tem beam: e' o
             mesmo passe nos dois casos (e ja e' mais rapido que o beam 1 do base).

Diferenças honestas em relacao ao whisper:
  - Nao existe parametro de lingua: o v3 detecta sozinho entre as 25. Em pt-BR
    ele acerta; o risco e' trecho MUITO curto (< 1 s) sair em espanhol/galego.
  - Ja devolve pontuacao e maiusculas.
  - Nao alucina em silencio (devolve texto vazio).

Se o modelo NAO estiver baixado, o padrao e' falhar rapido e explicar, em vez
de puxar 640 MB no meio do uso do app:
  stdout  {"pronto": false, "erro": "modelo Parakeet nao baixado ..."}   e sai com codigo 2
Pra baixar: `python ouvinte-parakeet.py --baixar` (baixa se faltar e segue como ouvinte).

Uso direto (fora do app):
  python ouvinte-parakeet.py                          # modo ouvinte (o app usa este)
  python ouvinte-parakeet.py --baixar                 # idem, baixando o modelo se faltar
  python ouvinte-parakeet.py --teste a.wav [b.wav]    # transcreve e mostra texto + tempo
  python ouvinte-parakeet.py --teste --pcm a.pcm      # idem, arquivo int16 16 kHz cru
  python ouvinte-parakeet.py --info                   # so' diz se o modelo esta' baixado

Venv esperado: C:\\Users\\<user>\\venv-transcricao (Python 3.12, onnx-asr[cpu,hub]).
"""
import os
import sys

# ---- ajustes que precisam vir ANTES de importar qualquer coisa pesada ----
# 4 threads, igual aos ouvintes whisper: com o padrao (todos os nucleos) os
# processos de voz brigam entre si e a legenda ao vivo e' quem atrasa.
THREADS = 4
os.environ.setdefault("OMP_NUM_THREADS", str(THREADS))
# O huggingface_hub le' HF_HUB_OFFLINE na importacao. Sem "--baixar", travamos
# a rede aqui: se o modelo nao estiver no cache, a carga falha na hora com
# FileNotFoundError em vez de tentar baixar.
BAIXAR = "--baixar" in sys.argv
if not BAIXAR:
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
# barra de progresso do download iria pro stderr; o app ignora stderr, mas em
# terminal ela polui - so' aparece quando a pessoa pediu o download
if not BAIXAR:
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

import json      # noqa: E402
import time      # noqa: E402

MODELO = "nemo-parakeet-tdt-0.6b-v3"
QUANT = "int8"
TAXA = 16000
# Menos que isto e o encoder nao tem frame suficiente pra trabalhar: completa
# com silencio ate' 0,5 s. Nao muda o texto, so' evita erro em trecho minusculo.
MIN_AMOSTRAS = TAXA // 2

COMO_BAIXAR = (
    "modelo Parakeet nao baixado. Rode uma vez: "
    "\"%s\" \"%s\" --baixar   (baixa ~640 MB para o cache do Hugging Face)"
    % (sys.executable, os.path.abspath(__file__))
)


def responder(obj):
    """Uma linha JSON no stdout, sem buffer — e' assim que o app le."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def avisar(msg):
    """Log humano vai pro stderr: o app descarta, o terminal mostra."""
    try:
        sys.stderr.write(msg + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def rss_mb():
    """RAM residente deste processo em MB (Windows via psapi; POSIX via resource)."""
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            class PMC(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
                ]
            pmc = PMC(); pmc.cb = ctypes.sizeof(PMC)
            k32 = ctypes.windll.kernel32
            # sem tipar, o HANDLE (-1) vira int de 32 bits e a chamada falha em silencio
            k32.GetCurrentProcess.restype = wintypes.HANDLE
            fn = ctypes.windll.psapi.GetProcessMemoryInfo
            fn.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
            fn.restype = wintypes.BOOL
            if not fn(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
                return -1.0
            return pmc.WorkingSetSize / (1024 * 1024)
        import resource
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    except Exception:
        return -1.0


def carregar_modelo():
    """Carrega o Parakeet. Levanta FileNotFoundError se nao estiver baixado (modo offline)."""
    import onnxruntime as rt
    import onnx_asr
    so = rt.SessionOptions()
    so.intra_op_num_threads = THREADS
    so.inter_op_num_threads = 1
    # o onnx-asr repassa estas opcoes pro encoder, pro decoder e pro
    # pre-processador (mel), entao o limite de threads vale pra tudo
    return onnx_asr.load_model(MODELO, quantization=QUANT, sess_options=so, providers=["CPUExecutionProvider"])


def ler_pcm(caminho):
    """Arquivo int16 cru -> float32 em [-1, 1], com o MESMO ganho do ouvinte whisper."""
    import numpy as np
    dados = np.fromfile(caminho, dtype=np.int16).astype(np.float32) / 32768.0
    return normalizar(dados)


def ler_wav(caminho):
    """WAV PCM 16 kHz mono -> float32. Outro formato: converte antes com ffmpeg."""
    import wave
    import numpy as np
    with wave.open(caminho, "rb") as w:
        canais, largura, taxa, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        bruto = w.readframes(n)
    if largura != 2:
        raise ValueError("WAV precisa ser PCM 16 bits (este tem %d bytes por amostra)" % largura)
    if taxa != TAXA:
        raise ValueError("WAV precisa ser %d Hz (este e' %d Hz) - converta: ffmpeg -i in -ar 16000 -ac 1 out.wav" % (TAXA, taxa))
    dados = np.frombuffer(bruto, dtype=np.int16).astype(np.float32) / 32768.0
    if canais > 1:
        dados = dados.reshape(-1, canais).mean(axis=1)
    return normalizar(dados)


def normalizar(dados):
    """Copia fiel do ouvinte whisper: microfone fraco sobe ate' pico 0,7; silencio
    puro (pico < 0,004) fica como esta' - amplificar chiado e' pedir frase inventada."""
    import numpy as np
    pico = float(np.max(np.abs(dados))) if dados.size else 0.0
    if 0.004 < pico < 0.5:
        dados = dados * (0.7 / pico)
    if dados.size < MIN_AMOSTRAS:
        dados = np.pad(dados, (0, MIN_AMOSTRAS - dados.size))
    return np.ascontiguousarray(dados, dtype=np.float32)


def transcrever(modelo, dados):
    """float32 16 kHz -> texto. Sem parametro de lingua: o v3 detecta sozinho."""
    texto = modelo.recognize(dados, sample_rate=TAXA)
    return (texto or "").strip()


# ---------------------------------------------------------------- modos ----

def modo_info():
    """So' responde se o modelo esta' no cache, sem carregar nada."""
    from huggingface_hub import snapshot_download
    try:
        pasta = snapshot_download("istupakov/parakeet-tdt-0.6b-v3-onnx", local_files_only=True,
                                  allow_patterns=["config.json", "vocab.txt", "*int8.onnx", "*int8.onnx?data"])
        tam = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(pasta) for f in fs)
        responder({"baixado": True, "pasta": pasta, "mb": round(tam / (1024 * 1024))})
        return 0
    except Exception:
        responder({"baixado": False, "erro": COMO_BAIXAR})
        return 2


def modo_teste(args):
    """--teste: carrega, transcreve cada arquivo e mostra texto + tempo."""
    eh_pcm = "--pcm" in args
    arquivos = [a for a in args if not a.startswith("--")]
    if not arquivos:
        avisar("uso: ouvinte-parakeet.py --teste [--pcm] arquivo [arquivo ...]")
        return 1
    t0 = time.time()
    try:
        modelo = carregar_modelo()
    except FileNotFoundError:
        avisar("ERRO: " + COMO_BAIXAR)
        return 2
    t_carga = time.time() - t0
    # mesmo passe de aquecimento do modo ouvinte, senao o 1o arquivo paga a
    # alocacao do onnxruntime e o tempo dele sai inflado
    try:
        import numpy as np
        transcrever(modelo, np.zeros(TAXA * 5, dtype=np.float32))
    except Exception:
        pass
    print("modelo carregado em %.1fs, aquecido em %.1fs no total | RAM %.0f MB"
          % (t_carga, time.time() - t0, rss_mb()), flush=True)
    for arq in arquivos:
        try:
            dados = ler_pcm(arq) if eh_pcm else ler_wav(arq)
            t1 = time.time()
            texto = transcrever(modelo, dados)
            dt = time.time() - t1
            dur = dados.size / TAXA
            print("%s | audio %.1fs | levou %.2fs (%.0fx tempo real) | %s"
                  % (os.path.basename(arq), dur, dt, (dur / dt) if dt > 0 else 0, texto or "(vazio)"), flush=True)
        except Exception as e:
            print("%s | ERRO: %s" % (os.path.basename(arq), e), flush=True)
    print("RAM ao final %.0f MB" % rss_mb(), flush=True)
    return 0


def modo_ouvinte():
    """Modo que o app usa: carrega, avisa 'pronto' e atende um pedido por linha."""
    try:
        modelo = carregar_modelo()
    except FileNotFoundError:
        # o app hoje ignora linha sem id e sem pronto=true; quem for integrar
        # pode ler o "erro" desta linha antes de o processo sair com codigo 2
        responder({"pronto": False, "erro": COMO_BAIXAR})
        avisar("ERRO: " + COMO_BAIXAR)
        return 2
    except Exception as e:
        responder({"pronto": False, "erro": "nao consegui carregar o Parakeet: %s" % e})
        avisar("ERRO ao carregar: %r" % (e,))
        return 3

    # primeiro passe do onnxruntime e' mais lento (aloca a memoria de trabalho
    # pro tamanho do audio); gastamos isso agora, com 5 s de silencio - tamanho
    # de frase tipica - pra primeira frase de verdade nao pagar (medido: 1,4 s
    # na primeira contra 0,8 s nas seguintes, sem este passe)
    try:
        import numpy as np
        transcrever(modelo, np.zeros(TAXA * 5, dtype=np.float32))
    except Exception:
        pass

    responder({"pronto": True})

    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            pedido = json.loads(linha)
        except Exception:
            continue
        ident = pedido.get("id")
        try:
            alvo = pedido.get("pcm")
            if alvo:
                dados = ler_pcm(alvo)
            else:
                wav = pedido.get("wav")
                if not wav:
                    raise ValueError("pedido sem 'pcm' nem 'wav'")
                dados = ler_wav(wav)
            # "rapido" e' aceito e ignorado: TDT nao tem beam pra escolher
            texto = transcrever(modelo, dados)
            responder({"id": ident, "texto": texto})
        except Exception as e:
            responder({"id": ident, "erro": str(e)})
    return 0


def main():
    args = sys.argv[1:]
    if "--info" in args:
        # falta o pacote (nao o modelo): dizer isso, senao a pessoa roda --baixar e falha de novo
        try:
            import onnx_asr  # noqa: F401
            from huggingface_hub import snapshot_download  # noqa: F401  (o extra [hub])
        except ImportError as e:
            responder({"baixado": False, "erro": "falta instalar onnx-asr[cpu,hub] no venv: %s" % e})
            return 3
        return modo_info()
    if "--teste" in args:
        return modo_teste([a for a in args if a != "--teste"])
    return modo_ouvinte()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyboardInterrupt, BrokenPipeError):
        # o app fechou o stdin ou matou o processo: sai quieto, sem traceback
        sys.exit(0)
