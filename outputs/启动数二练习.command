#!/bin/zsh
cd -- "${0:A:h}" || exit 1
python3 - <<'PY'
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

origin = 'http://127.0.0.1:17846'
local = build_opener(ProxyHandler({}))
def running():
    try:
        with local.open(origin + '/api/session', timeout=.7) as reply:
            data = json.load(reply)
        return isinstance(data, dict) and {'csrf', 'connectionId', 'canWrite', 'connected'} <= data.keys()
    except (ValueError, OSError, URLError):
        return False

if not running():
    with open('/dev/null', 'r+b') as quiet:
        server = subprocess.Popen([sys.executable, str(Path('daguan_server.py').resolve())],
                                  stdin=quiet, stdout=quiet, stderr=quiet, start_new_session=True)
    for _ in range(45):
        if running():
            break
        if server.poll() is not None:
            sys.exit('练习服务未能启动。请检查端口 17846 是否已被其他程序占用。')
        time.sleep(.12)
    else:
        sys.exit('练习服务尚未就绪，请稍后重试。')
print('练习站已启动：' + origin + '/', flush=True)
result = subprocess.run(['open', '-a', 'Google Chrome', origin + '/'])
if result.returncode:
    subprocess.run(['open', origin + '/'])
PY
