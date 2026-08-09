"""v2 gapless preload regression: queue play 2 tones through audio_server."""
import json
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:18084"
TONE30 = r"D:\AI\AudioPlayer\.diagnostics-run\diagnostic-tone-30s.wav"
TONE10 = r"D:\AI\AudioPlayer\.diagnostics-run\diagnostic-tone-10s.wav"


TOKEN = "test-token-123"


def post(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def get(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + TOKEN})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def main():
    post("/domain/queue", {"paths": [TONE30, TONE10]})
    print("queue replaced", flush=True)
    post("/domain/queue/play", {})
    print("queue play started", flush=True)

    seen_pending = False
    seen_swap = False
    t0 = time.time()
    last_path = None
    while time.time() - t0 < 60:
        try:
            st = get("/state")
        except Exception as e:
            print("state err", e)
            time.sleep(1)
            continue
        inner = st.get("state") if isinstance(st, dict) and "state" in st else st
        cur = inner.get("current_track_path") or inner.get("file_path")
        if cur and cur != last_path:
            if last_path is not None:
                print(f"[{time.time()-t0:6.1f}s] TRACK SWAPPED -> {cur.split(chr(92))[-1]}")
                seen_swap = True
            else:
                print(f"[{time.time()-t0:6.1f}s] first track: {cur.split(chr(92))[-1]}")
            last_path = cur
        diag = None
        try:
            diag = get("/diagnostics/runtime")
        except Exception:
            pass
        if diag:
            inner = diag.get("snapshot") or diag
            ledger = (inner.get("decode") or {}).get("memory_ledger") or {}
            owners_list = ledger.get("reserved_by_owner") or []
            owners = {o.get("owner"): o.get("reserved_bytes", 0) for o in owners_list}
            pending_mb = owners.get("pending playback", 0) / (1024 * 1024)
            active_mb = owners.get("active window", 0) / (1024 * 1024)
            state_playing = (inner.get("player") or {}).get("state")
            if pending_mb > 0 and not seen_pending:
                print(f"[{time.time()-t0:6.1f}s PENDING PLAYBACK owner visible: {pending_mb:.1f} MiB")
                seen_pending = True
            print(
                f"[{time.time()-t0:6.1f}s state={state_playing} "
                f"ledger owners: active={active_mb:.1f} MiB pending={pending_mb:.1f} MiB"
            )
        if seen_swap:
            break
        time.sleep(0.5)

    ok = seen_pending and seen_swap
    print("RESULT:", "PASS v2-gapless" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()