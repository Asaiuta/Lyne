import json, random, sys, time, urllib.request

BASE = "http://127.0.0.1:18084"
H = {"Authorization": "Bearer test-token-123", "Content-Type": "application/json"}
T480 = r"D:\AI\AudioPlayer\.diagnostics-run\diagnostic-tone-240s.wav"
T10 = r"D:\AI\AudioPlayer\.diagnostics-run\diagnostic-tone-10s.wav"

def req(p, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE+p, data=data, headers=H, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(r, timeout=10) as f:
        try: return json.loads(f.read())
        except Exception: return None

def ws_mb():
    import subprocess
    out = subprocess.run(["powershell.exe","-NoProfile","-Command",
        "(Get-Process audio_server).WorkingSet64 / 1MB"], capture_output=True, text=True).stdout.strip()
    try: return round(float(out.splitlines()[-1]), 1)
    except Exception: return None

def diag():
    d = req("/diagnostics/runtime") or {}
    snap = d.get("snapshot") or {}
    dec = snap.get("decode") or {}
    return dec

def run(label):
    print(f"===== {label} =====")
    req("/domain/queue", {"paths": [T480, T10]})
    req("/domain/queue/play", {"source_path": T480})
    time.sleep(10)
    ws = ws_mb()
    d = diag()
    print(f"WS={ws} MB ledger_rej={d.get('memory_ledger',{}).get('rejection_count')} budget_rej={d.get('budget_rejection_count')} underrun={d.get('underrun_count')}")
    # 20 cross-window seeks via the real /seek endpoint
    random.seed(7)
    tg, errs = 0.0, []
    for i in range(20):
        while True:
            cand = random.uniform(15, 460)
            if abs(cand - tg) > 30:
                break
        tg = round(cand, 1)
        req("/seek", {"position": tg})
        time.sleep(1.6)
        st = req("/state")["state"]
        cur = st["current_time"]
        errs.append(abs(cur - tg))
        if i in (0, 9, 19):
            print(f"  seek#{i+1} tgt={tg} cur={cur:.1f} err={cur-tg:+.2f}s")
    valid = [e for e in errs]
    print(f"  seek err: max={max(valid):.2f}s mean={sum(valid)/len(valid):.2f}s over 20 (1.6s settle => expect ~1.6)")
    # gapless: 480s is ~30% consumed; let it finish into 10s track
    ws2 = ws_mb()
    print(f"WS during playback (mid 480s) = {ws2} MB")
    t0 = time.time()
    while time.time() - t0 < 20:
        st = req("/state")["state"]
        if st["file_path"] and "tone-10s" in st["file_path"]:
            print(f"  swapped to 10s track at cur={st['current_time']:.1f} (gapless OK)")
            break
        time.sleep(2)
    else:
        print("  no swap observed in 20s (FAIL)")
    time.sleep(8)
    st = req("/state")["state"]
    print(f"  final cur={st['current_time']:.1f}/10.0 playing={st['is_playing']}")
    d = diag()
    print(f"final: ledger_rej={d.get('memory_ledger',{}).get('rejection_count')} budget_rej={d.get('budget_rejection_count')} underrun={d.get('underrun_count')}")

if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "baseline")
