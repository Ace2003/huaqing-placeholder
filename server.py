"""
猫的第六感 — 中文潜台词解码器
静态文件 + 智谱 GLM 解码 API
运行：python server.py    访问：http://localhost:8000
"""
import http.server
import socketserver
import json
import urllib.request
import urllib.error
import os
import sys
import time
import threading
import re

PORT = int(os.environ.get('PORT', 8000))
HERE = os.path.dirname(os.path.abspath(__file__))

API_KEYS = [
    '86aece543dff48798823dd54fc966df9.Px9gdN9vyQZ2Wko2',
    'a82b9549b8b7424cb174af70820ecf55.Mbaq71CKLy1yYanZ',
]
KEY_COOLDOWN = {}
KEY_COOLDOWN_SECONDS = 5 * 3600 + 600
KEY_LOCK = threading.Lock()

CODING_URL = 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'
GENERAL_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
MODEL = 'glm-4.5-air'

# 解码 prompt — 这是产品的核心壁垒
SYSTEM_PROMPT = """你是「猫的第六感」的中文潜台词解码引擎，搭载完整的「慧眼侧写引擎」16 条核心规则，专门破解中文沟通中的言外之意。

你的核心运算矩阵（仅供内部分析，输出时转成猫猫的温柔解码）：
- 语言模态：字面意思暴露"自我认同"，但真实意图藏在句式与选词里
- 文字模态：标点、语气词、停顿暴露真实情绪颗粒度
- 动作模态（输入节奏/措辞习惯）：暴露真实状态与生存焦虑
- 生存焦虑定律：所有反常措辞底层都是掩饰匮乏
- 关系确权定律：表达方式都是在向假想客体"证明"或"索取"
- 时间坍缩：某个用词可能锚定过去某段记忆或关系模式
- 散弹枪冷读：具体细节越精准，解码越有"被看穿"的震撼
- 情感电压律：措辞强度反映情感供电状态
- 镜像法则：用绝对尊重解锁对方的真实意图

【你的任务】
用户会粘贴一条中文消息（可能是对方发来的，也可能是自己想发的，或是某段对话）。你要解码出字面之下的真相。

【输出结构】只输出 JSON，不要 Markdown，不要解释：
{
  "surface_meaning": "字面意思（1句，直接陈述）",
  "real_emotion": "对方的真实情绪（具象，1句，要精准到让用户心头一震）",
  "what_they_want": "对方真正想要什么（说破对方自己都没意识到的渴望）",
  "subtext": "潜台词，还原对方没说出口的那句话（第一人称，像对方在心里对自己说）",
  "context_clue": "一个精准的背景推测（散弹枪冷读：关于对方此时此刻的状态/场景/关系位置的极度具体的细节）",
  "danger_level": "green | yellow | red（green=正常沟通，yellow=有情绪需小心，red=危机信号/冷暴力/试探底线）",
  "suggested_reply": "建议回复（1句，自然口语，能化解当前局面或推进关系）",
  "cat_whisper": "猫猫的一句温柔提醒（不超过15字，像猫在你耳边说，给用户安全感或点醒）",
  "emotion_tag": "happy | tired | anxious | wronged | annoyed | indifferent | flirty | defensive"
}

【emotion_tag 细分】
- happy：开心、热情、积极
- tired：疲惫、敷衍、没精力
- anxious：焦虑、紧张、过载
- wronged：委屈、受伤、想哭
- annoyed：烦躁、被打扰、抗拒
- indifferent：冷漠、回避、划清界限
- flirty：暧昧、试探、有好感
- defensive：防御、推卸、找借口

【danger_level 判断】
- green：正常社交，字面=真实
- yellow：对方有情绪但没爆发，需要共情或给空间
- red：冷暴力、PUA试探、情绪勒索、关系危机信号

【语气铁律】
- 解码要"狠"地准：精准到让用户起鸡皮疙瘩，"天哪它怎么知道"
- 但猫猫的提醒(cat_whisper)要温柔，给用户力量而不是焦虑
- suggested_reply 要自然像朋友帮你打字的，不要客服腔
- 严禁说教、严禁心理学术语、严禁"建议你们好好沟通"这种废话

【示例】
输入：「随便吧」
输出：
{
  "surface_meaning": "对选项没有偏好",
  "real_emotion": "已经累了，不想再做任何决定",
  "what_they_want": "希望你能替TA做一次决定，让TA不用再承担选择的责任",
  "subtext": "我一直在配合，我也想被照顾一次",
  "context_clue": "对方最近可能连续做了太多妥协，这次是第N次让步后的疲倦",
  "danger_level": "yellow",
  "suggested_reply": "那我们去吃你上次说想吃的那家",
  "cat_whisper": "TA在等你主动呀",
  "emotion_tag": "tired"
}

【背景档案（如有）】
用户可能提供目标对象的人物档案，包含：称呼、关系、性格、背景、用户对TA的想法、猜测TA的想法、历史互动。
如果有档案，你的解码必须结合档案背景：同一句"随便吧"，恋人说和同事说，潜台词完全不同。
如果没档案，按通用场景解码，但 context_clue 要标注"无背景信息，基于通用推测"。

【危机处理】
若消息涉及自伤/暴力/严重危机：danger_level 设 red，cat_whisper 必须建议联系专业人士或紧急资源。"""


def _available_keys():
    now = time.time()
    with KEY_LOCK:
        ready = [k for k in API_KEYS if KEY_COOLDOWN.get(k, 0) <= now]
        return ready if ready else sorted(API_KEYS, key=lambda k: KEY_COOLDOWN.get(k, 0))


def _cool_key(key, until_ts=None, reason=''):
    if until_ts is None or until_ts <= time.time():
        until_ts = time.time() + KEY_COOLDOWN_SECONDS
    with KEY_LOCK:
        KEY_COOLDOWN[key] = until_ts
    sys.stderr.write(f'[key] {key[:8]}… cooled ({reason})\n')


def _is_quota_error(http_code, body):
    if http_code != 429:
        return False
    markers = ['1113', '1308', '余额', '额度', '5 小时', '5小时', '上限', '解除', 'quota', 'exceeded']
    return any(m.lower() in (body or '').lower() for m in markers)


def _parse_cooldown_until(body):
    if not body:
        return None
    m = re.search(r'(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})', body)
    if not m:
        return None
    try:
        return time.mktime(time.strptime(m.group(1), '%Y-%m-%d %H:%M:%S')) + 60
    except Exception:
        return None


def call_zhipu(user_text, endpoint, api_key, profile=None):
    profile_block = ''
    if profile and isinstance(profile, dict):
        parts = []
        labels = {
            'name': '称呼', 'relation': '关系', 'age': '年龄段', 'personality': '性格特征',
            'background': '背景信息', 'myThoughts': '你对TA的想法',
            'theirThoughts': '你猜TA对你的想法', 'history': '历史互动与反馈',
        }
        for k, label in labels.items():
            v = profile.get(k)
            if v and str(v).strip():
                parts.append(f'  {label}：{v}')
        if parts:
            profile_block = '\n\n【目标对象档案】\n' + '\n'.join(parts)

    user_content = f'需要解码的消息：\n「{user_text}」{profile_block}'

    payload = {
        'model': MODEL,
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': user_content},
        ],
        'temperature': 0.85,
        'max_tokens': 2000,
        'response_format': {'type': 'json_object'},
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'},
        method='POST',
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=60) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    content = data['choices'][0]['message']['content']
    if not content or not content.strip():
        sys.stderr.write(f'[decode] Empty content! finish_reason={data["choices"][0].get("finish_reason")} prompt_tokens={data.get("usage",{}).get("prompt_tokens")}\n')
    return content


# 本地兜底（网络不通时用）
FALLBACKS = {
    '随便': {'surface_meaning':'没有偏好','real_emotion':'已经累了不想做决定','what_they_want':'希望你替TA决定','subtext':'我一直在配合，也想被照顾一次','context_clue':'对方最近可能做了太多妥协','danger_level':'yellow','suggested_reply':'那我们去吃你上次说想吃的那家','cat_whisper':'TA在等你主动呀','emotion_tag':'tired'},
    '嗯': {'surface_meaning':'知道了','real_emotion':'敷衍或心不在焉','what_they_want':'结束这个话题','subtext':'我不想继续聊这个','context_clue':'对方可能在忙或对这个话题没兴趣','danger_level':'yellow','suggested_reply':'（分享一个有趣的事）你看这个','cat_whisper':'换个话题试试','emotion_tag':'indifferent'},
    '哦': {'surface_meaning':'听到了','real_emotion':'冷淡或失望','what_they_want':'TA希望你注意到TA的情绪','subtext':'你就这样回应我？','context_clue':'对方可能期待更多回应但没得到','danger_level':'yellow','suggested_reply':'怎么了？感觉你不太开心','cat_whisper':'TA在等你的关心','emotion_tag':'defensive'},
    '在吗': {'surface_meaning':'确认你是否在线','real_emotion':'有事相求或有话要说','what_they_want':'希望你给TA开口的机会','subtext':'我有事找你但不知怎么开口','context_clue':'对方可能要借钱/求助/表白/道歉','danger_level':'green','suggested_reply':'在的，怎么了？','cat_whisper':'深呼吸，听TA说','emotion_tag':'anxious'},
    '随便你': {'surface_meaning':'按你的意思来','real_emotion':'生气或不认同但不想争','what_they_want':'希望你注意到TA不同意','subtext':'我不同意但说了也没用','context_clue':'对方觉得自己的意见不被重视','danger_level':'red','suggested_reply':'我觉得你其实有想法，跟我说说？','cat_whisper':'这是危险信号哦','emotion_tag':'annoyed'},
    'default': {'surface_meaning':'字面意思','real_emotion':'对方情绪平稳','what_they_want':'正常沟通','subtext':'没有隐藏含义','context_clue':'','danger_level':'green','suggested_reply':'（正常回复即可）','cat_whisper':'猫猫在听','emotion_tag':'indifferent'},
}

def _local_fallback(text):
    for key, val in FALLBACKS.items():
        if key != 'default' and key in text:
            return {**val, 'fallback': True}
    return {**FALLBACKS['default'], 'fallback': True}


def _validate(parsed, user_text):
    if not isinstance(parsed, dict):
        return _local_fallback(user_text)
    required = ['surface_meaning','real_emotion','what_they_want','subtext','context_clue','danger_level','suggested_reply','cat_whisper','emotion_tag']
    valid_dangers = {'green','yellow','red'}
    valid_emotions = {'happy','tired','anxious','wronged','annoyed','indifferent','flirty','defensive'}
    fb = _local_fallback(user_text)
    fb.pop('fallback', None)
    for k in required:
        if not parsed.get(k) or (k == 'danger_level' and parsed.get(k) not in valid_dangers) or (k == 'emotion_tag' and parsed.get(k) not in valid_emotions):
            parsed[k] = fb.get(k, FALLBACKS['default'][k])
    return parsed


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path == '/api/decode':
            self._handle_decode()
        else:
            self._send_json({'error': 'not found'}, 404)

    def do_GET(self):
        if self.path == '/api/status':
            now = time.time()
            with KEY_LOCK:
                keys = [{'key': k[:8]+'…', 'status': 'ready' if KEY_COOLDOWN.get(k,0)<=now else 'cooling'} for k in API_KEYS]
            self._send_json({'model': MODEL, 'keys': keys})
        else:
            super().do_GET()

    def _handle_decode(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length).decode('utf-8') if length else ''
            body = json.loads(raw) if raw else {}
            text = (body.get('text') or '').strip()
            profile = body.get('profile') or None
            if not text:
                self._send_json({'error': 'text is required'}, 400)
                return

            keys = _available_keys()
            # 有档案时优先用通用端点（coding 端点对长 prompt 偶发返回空）
            if profile:
                endpoints = [(GENERAL_URL,'general'), (CODING_URL,'coding')]
            else:
                endpoints = [(CODING_URL,'coding'), (GENERAL_URL,'general')]
            content = None
            err = None
            tried = []

            for key in keys:
                for ep_url, ep_label in endpoints:
                    tag = f'{key[:8]}…/{ep_label}'
                    try:
                        content = call_zhipu(text, ep_url, key, profile)
                        if content and content.strip():
                            tried.append(f'{tag}=OK')
                            break
                        else:
                            tried.append(f'{tag}=EMPTY')
                            content = None
                            continue
                    except urllib.error.HTTPError as e:
                        err_body = e.read().decode('utf-8', errors='ignore')[:300]
                        err = f'{tag} HTTP {e.code}'
                        tried.append(f'{tag}=HTTP{e.code}')
                        if _is_quota_error(e.code, err_body):
                            _cool_key(key, _parse_cooldown_until(err_body), f'HTTP {e.code}')
                            break
                        if e.code in (401, 403):
                            break
                    except Exception as e:
                        err = f'{tag} error'
                        tried.append(f'{tag}=ERR')
                    except urllib.error.HTTPError as e:
                        err_body = e.read().decode('utf-8', errors='ignore')[:300]
                        err = f'{tag} HTTP {e.code}'
                        tried.append(f'{tag}=HTTP{e.code}')
                        if _is_quota_error(e.code, err_body):
                            _cool_key(key, _parse_cooldown_until(err_body), f'HTTP {e.code}')
                            break
                        if e.code in (401, 403):
                            break
                    except Exception as e:
                        err = f'{tag} error'
                        tried.append(f'{tag}=ERR')
                if content is not None:
                    break

            sys.stderr.write(f'[decode] tried: {tried}\n')

            if content is None:
                self._send_json(_local_fallback(text))
                return

            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                sys.stderr.write(f'[decode] JSON parse failed, raw content (first 500):\n{content[:500]}\n')
                m = re.search(r'\{[\s\S]*\}', content)
                if m:
                    try:
                        parsed = json.loads(m.group(0))
                    except Exception:
                        parsed = _local_fallback(text)
                else:
                    parsed = _local_fallback(text)

            parsed = _validate(parsed, text)
            self._send_json(parsed)

        except Exception as e:
            self._send_json({**_local_fallback(body.get('text','') if isinstance(body,dict) else ''), 'error': str(e)})

    def _send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(data))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass  # 静默日志


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    with ReusableServer(('', PORT), Handler) as httpd:
        print('=' * 50)
        print('  猫的第六感 · 已启动')
        print(f'  访问：http://localhost:{PORT}')
        print('=' * 50)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已停止')
            httpd.shutdown()


if __name__ == '__main__':
    main()
