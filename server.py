"""
猫的第六感 — 中文潜台词解码器
静态文件 + StepFun 多模态 LLM
运行：python server.py    访问：http://localhost:8000
"""
import http.server
import socketserver
import json
import urllib.request
import urllib.error
import os
import sys
import re

PORT = int(os.environ.get('PORT', 8000))
HERE = os.path.dirname(os.path.abspath(__file__))

# StepFun API — key 从环境变量 STEPFUN_KEY 读取（Render 后台配置）
STEPFUN_URL = 'https://api.stepfun.com/step_plan/v1/chat/completions'
STEPFUN_KEY = os.environ.get('STEPFUN_KEY', '')
STEPFUN_MODEL = 'step-3.7-flash'

# 解码 prompt — 这是产品的核心壁垒
SYSTEM_PROMPT = """你是「猫的第六感」的中文潜台词解码引擎，搭载完整的「慧眼侧写引擎」核心规则，专门破解中文沟通中的言外之意。

你的核心运算矩阵（仅供内部分析，输出时转成猫猫的温柔解码）：
- 语言模态：字面意思暴露"自我认同"，但真实意图藏在句式与选词里
- 文字模态：标点、语气词、停顿暴露真实情绪颗粒度
- 动作模态（输入节奏/措辞习惯）：暴露真实状态与生存焦虑
- 生存焦虑定律：所有反常措辞底层都是掩饰匮乏
- 短择定律：人类几乎所有行为都是"短期利益最大化"——大脑天然偏【最近、最省力、立即可得】的选项，哪怕远处明显更好（饿但不愿多走 100 米，宁可啃手边面包）。亲密关系里同样成立：对方敷衍、回避、说"随便"、已读不回，往往不是不在意，而是当下"不投入"是最低能耗路径。所有"懒得回/不想解释/随口应付"底层都是这套
- 择短进化：当情绪资源充足（被爱、被托底、有安全感）时，短择会升级为"择短"——主动扫描并抓住最大化机会。所以"主动找你/主动分享/主动表达"本身就是资源充裕的信号；反过来被动、应付、惜字如金，是资源枯竭的表现。这条比"TA 在不在乎你"更准
- 关系确权定律：表达方式都是在向假想客体"证明"或"索取"
- 时间坍缩：某个用词可能锚定过去某段记忆或关系模式
- 散弹枪冷读：具体细节越精准，解码越有"被看穿"的震撼；同时用短择/择短判断对方当前的情绪资源水位——是"勉强应付"还是"主动投入"
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
  "context_clue": "一个精准的背景推测（散弹枪冷读：关于对方此时此刻的状态/场景/关系位置的极度具体的细节；并用短择/择短原理判断 TA 当前是勉强应付还是主动投入——情绪资源水位的精准读数）",
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


BATCH_PROMPT = """你是「猫的第六感」的关系动态分析引擎。用户会粘贴两个人（"我"和"TA"）的一段聊天记录。你要从对话中分析出关系动态。

核心原理：短择定律——人几乎所有行为都是短期利益最大化；情绪资源充足时会升级为"择短"（主动投入、主动分享、主动表达），枯竭时表现为被动应付、惜字如金、已读不回。用这条原理判断两人的真实状态和关系水位，比"谁爱谁多"更准。

输出 JSON：
{
  "power_dynamic": "权力动态分析：谁主动谁被动，谁在追谁在退，1-2句",
  "their_hidden_state": "TA的隐藏情绪状态和真实想法（用侧写逻辑解码；标出 TA 当前是择短还是短择——主动还是应付）",
  "your_hidden_state": "用户的隐藏情绪状态和真实需求",
  "deadlock": "沟通死结：你们陷入了什么循环（精准到让人心头一震）",
  "health_level": "green | yellow | red",
  "health_detail": "关系健康度的具体说明",
  "advice": "猫猫的建议：打破当前困局的具体行动（口语，可操作）",
  "cat_whisper": "猫猫一句温柔提醒（15字内）"
}

语气：侧写要狠，建议要暖。不用说教和废话。"""


def _stepfun_chat(messages, temperature=0.85, max_tokens=8000, json_mode=False, timeout=60):
    """统一 StepFun chat completions 调用。返回模型文本或抛异常。"""
    if not STEPFUN_KEY:
        raise RuntimeError('server missing STEPFUN_KEY env')
    payload = {
        'model': STEPFUN_MODEL,
        'messages': messages,
        'temperature': temperature,
        'max_tokens': max_tokens,
    }
    if json_mode:
        payload['response_format'] = {'type': 'json_object'}
    req = urllib.request.Request(
        STEPFUN_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {STEPFUN_KEY}'},
        method='POST',
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    choice = data['choices'][0]
    content = choice.get('message', {}).get('content') or ''
    finish = choice.get('finish_reason')
    if not content.strip():
        sys.stderr.write(f'[stepfun] empty content finish={finish} usage={data.get("usage")}\n')
    return content


def _build_profile_block(profile):
    if not (profile and isinstance(profile, dict)):
        return ''
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
    return '\n\n【目标对象档案】\n' + '\n'.join(parts) if parts else ''


def call_llm_decode(user_text, profile=None):
    user_content = f'需要解码的消息：\n「{user_text}」{_build_profile_block(profile)}'
    content = _stepfun_chat(
        messages=[
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': user_content},
        ],
        temperature=0.85,
        max_tokens=8000,
        json_mode=True,
        timeout=60,
    )
    if not content.strip():
        sys.stderr.write(f'[decode] empty content for input: {user_text[:30]!r}\n')
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
            return {**val, 'fallback': True, 'degraded': True}
    return {**FALLBACKS['default'], 'fallback': True, 'degraded': True}


def _validate(parsed, user_text):
    if not isinstance(parsed, dict):
        return _local_fallback(user_text)
    required = ['surface_meaning','real_emotion','what_they_want','subtext','context_clue','danger_level','suggested_reply','cat_whisper','emotion_tag']
    valid_dangers = {'green','yellow','red'}
    valid_emotions = {'happy','tired','anxious','wronged','annoyed','indifferent','flirty','defensive'}
    fb = _local_fallback(user_text)
    fb.pop('fallback', None)
    fb.pop('degraded', None)
    for k in required:
        if not parsed.get(k) or (k == 'danger_level' and parsed.get(k) not in valid_dangers) or (k == 'emotion_tag' and parsed.get(k) not in valid_emotions):
            parsed[k] = fb.get(k, FALLBACKS['default'][k])
    return parsed


def _batch_fallback(text):
    return {
        'power_dynamic': '对方在回避，你在追。你越问对方越退，形成了追逐-逃避的循环。',
        'their_hidden_state': 'TA在用简短回复拉开距离，可能感到压力或对关系有疲惫感，但没到完全放弃。',
        'your_hidden_state': '你在反复试探，本质上是在确认"TA还在不在乎我"，这份不安让你不断发起对话。',
        'deadlock': '你越想靠近，TA越后退——因为你的"关心"在TA感受里变成了"要求"。',
        'health_level': 'yellow',
        'health_detail': '关系有裂痕但还能修复，需要调整沟通节奏。',
        'advice': '停3天主动联系。在这3天里有情绪就写下来不发送。让TA主动来找你一次。',
        'cat_whisper': '先学会暂停，TA会来找你的',
        'degraded': True,
    }


# 路演 demo 预置消息（保底杀手级结果）
DEMO_PRESETS = [
    {'text': '嗯', 'result': {'surface_meaning':'知道了','real_emotion':'敷衍或心不在焉，对这个话题没有投入','what_they_want':'想结束这段对话，但又不想显得太冷漠','subtext':'我不想继续聊这个，但又不好意思直接说','context_clue':'对方可能在忙，或者反复在你们的关系里感到疲惫','danger_level':'yellow','suggested_reply':'（分享一个有趣的事）你看这个哈哈','cat_whisper':'TA的心不在这里哦','emotion_tag':'indifferent'}},
    {'text': '我没事', 'result': {'surface_meaning':'我很好，不用担心','real_emotion':'有事，但在压着不说。这句话本身就是求救信号','what_they_want':'希望你能注意到TA不对劲，然后主动追问——而不是真的相信"没事"','subtext':'我有事但说了也没用，我等你发现','context_clue':'对方近期可能经历了一些TA觉得"说了你也不懂"的委屈','danger_level':'red','suggested_reply':'你不用骗我。我不问你什么事，但我在这里，想说的时候随时说。','cat_whisper':'这三个字是最重的求救','emotion_tag':'wronged'}},
    {'text': '随便你', 'result': {'surface_meaning':'按你的意思来','real_emotion':'生气了，而且已经懒得解释为什么生气','what_they_want':'希望你停下来想一想TA为什么不开心——而不是真的"随便"','subtext':'我不同意，但说了你也不会听，算了','context_clue':'对方觉得自己的意见一直被忽视，这次是情绪积累后的放弃','danger_level':'red','suggested_reply':'我觉得你其实有想法。跟我说说？我想听。','cat_whisper':'这是危险信号，别忽略','emotion_tag':'annoyed'}},
]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path == '/api/decode':
            self._handle_decode()
        elif self.path == '/api/decode_batch':
            self._handle_batch()
        elif self.path == '/api/parse_image':
            self._handle_parse_image()
        else:
            self._send_json({'error': 'not found'}, 404)

    def do_GET(self):
        if self.path == '/api/status':
            self._send_json({
                'model': STEPFUN_MODEL,
                'provider': 'stepfun',
                'key_configured': bool(STEPFUN_KEY),
            })
        elif self.path == '/api/demos':
            self._send_json({'demos': DEMO_PRESETS})
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

            content = None
            degraded_reason = None
            try:
                content = call_llm_decode(text, profile)
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='ignore')[:300]
                degraded_reason = f'StepFun HTTP {e.code}'
                sys.stderr.write(f'[decode] stepfun HTTP {e.code}: {err_body}\n')
            except urllib.error.URLError as e:
                degraded_reason = f'StepFun 网络超时 ({e.reason})'
                sys.stderr.write(f'[decode] stepfun URLError: {e}\n')
            except Exception as e:
                degraded_reason = f'StepFun 调用异常: {e}'
                sys.stderr.write(f'[decode] stepfun error: {e}\n')

            if not content or not content.strip():
                fb = _local_fallback(text)
                if degraded_reason:
                    fb['degraded_reason'] = degraded_reason
                if not STEPFUN_KEY:
                    fb['degraded_reason'] = '服务端未配置 STEPFUN_KEY 环境变量'
                self._send_json_safe(fb)
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
                        parsed['degraded_reason'] = 'StepFun 返回内容不是合法 JSON，已用兜底'
                else:
                    parsed = _local_fallback(text)
                    parsed['degraded_reason'] = 'StepFun 返回内容不是合法 JSON，已用兜底'

            parsed = _validate(parsed, text)
            self._send_json_safe(parsed)

        except Exception as e:
            sys.stderr.write(f'[decode] outer exception: {e}\n')
            self._send_json_safe({**_local_fallback(body.get('text','') if isinstance(body,dict) else ''), 'error': str(e)})

    def _handle_batch(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length).decode('utf-8') if length else ''
            body = json.loads(raw) if raw else {}
            text = (body.get('text') or '').strip()
            if not text:
                self._send_json({'error': 'text is required'}, 400)
                return

            content = None
            degraded_reason = None
            try:
                content = _stepfun_chat(
                    messages=[
                        {'role': 'system', 'content': BATCH_PROMPT},
                        {'role': 'user', 'content': f'聊天记录：\n{text}'},
                    ],
                    temperature=0.85,
                    max_tokens=8000,
                    json_mode=True,
                    timeout=60,
                )
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='ignore')[:300]
                degraded_reason = f'StepFun HTTP {e.code}'
                sys.stderr.write(f'[batch] stepfun HTTP {e.code}: {err_body}\n')
            except urllib.error.URLError as e:
                degraded_reason = f'StepFun 网络超时 ({e.reason})'
                sys.stderr.write(f'[batch] stepfun URLError: {e}\n')
            except Exception as e:
                degraded_reason = f'StepFun 调用异常: {e}'
                sys.stderr.write(f'[batch] stepfun error: {e}\n')

            if not content or not content.strip():
                fb = _batch_fallback(text)
                if degraded_reason:
                    fb['degraded_reason'] = degraded_reason
                if not STEPFUN_KEY:
                    fb['degraded_reason'] = '服务端未配置 STEPFUN_KEY 环境变量'
                self._send_json_safe(fb)
                return

            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                sys.stderr.write(f'[batch] JSON parse failed, raw (first 500):\n{content[:500]}\n')
                m = re.search(r'\{[\s\S]*\}', content)
                if m:
                    try:
                        parsed = json.loads(m.group(0))
                    except Exception:
                        parsed = _batch_fallback(text)
                        parsed['degraded_reason'] = 'StepFun 返回不是合法 JSON，已用兜底'
                else:
                    parsed = _batch_fallback(text)
                    parsed['degraded_reason'] = 'StepFun 返回不是合法 JSON，已用兜底'

            self._send_json_safe(parsed)

        except Exception as e:
            sys.stderr.write(f'[batch] outer exception: {e}\n')
            self._send_json_safe({**_batch_fallback(''), 'error': str(e)})

    def _handle_parse_image(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length).decode('utf-8') if length else ''
            body = json.loads(raw) if raw else {}
            image_data = (body.get('image') or '').strip()
            if not image_data:
                self._send_json({'error': 'image is required'}, 400)
                return

            if not STEPFUN_KEY:
                sys.stderr.write('[parse_image] STEPFUN_KEY env not set\n')
                self._send_json({'error': 'server missing STEPFUN_KEY env'}, 500)
                return

            # 兼容两种入参：完整 data URL 或纯 base64
            mime = (body.get('mime') or '').strip().lower()
            if image_data.startswith('data:'):
                # 从 data URL 中拿 mime
                if not mime:
                    head = image_data.split(',', 1)[0]
                    m = re.search(r'data:([^;]+)', head)
                    if m:
                        mime = m.group(1).lower()
                image_data = image_data.split(',', 1)[1] if ',' in image_data else image_data
            if not mime:
                # 末路兜底：从 base64 头几个字节嗅探
                head = image_data[:8]
                if head.startswith('/9j/'):
                    mime = 'image/jpeg'
                elif head.startswith('iVBOR'):
                    mime = 'image/png'
                elif head.startswith('R0lGOD'):
                    mime = 'image/gif'
                elif head.startswith('UklGR'):
                    mime = 'image/webp'
                else:
                    mime = 'image/jpeg'

            content = None

            # 使用 StepFun API 进行图片识别
            try:
                payload = {
                    'model': STEPFUN_MODEL,
                    'messages': [{
                        'role': 'user',
                        'content': [
                            {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{image_data}'}},
                            {'type': 'text', 'text': '请提取这张聊天截图中的所有消息，按以下格式输出：\n我：xxx\nTA：xxx\n（保留原始顺序，每行一条消息。如果无法确定谁是我谁是TA，用"对方"代替TA）'}
                        ]
                    }],
                    'temperature': 0.3,
                    'max_tokens': 4000,
                }
                req = urllib.request.Request(
                    STEPFUN_URL,
                    data=json.dumps(payload).encode('utf-8'),
                    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {STEPFUN_KEY}'},
                    method='POST',
                )
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                # Render 网关 100s 强制断连，留 15s 余量给响应写回
                with opener.open(req, timeout=85) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                choice = data['choices'][0]
                c = choice.get('message', {}).get('content') or ''
                finish = choice.get('finish_reason')
                if c and c.strip():
                    content = c.strip()
                    sys.stderr.write(f'[parse_image] success mime={mime} finish={finish}\n')
                else:
                    sys.stderr.write(f'[parse_image] empty content finish={finish} usage={data.get("usage")}\n')
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='ignore')[:300]
                sys.stderr.write(f'[parse_image] stepfun HTTP {e.code}: {err_body}\n')
                self._send_json_safe({'error': f'stepfun HTTP {e.code}', 'details': err_body}, 502)
                return
            except urllib.error.URLError as e:
                # 多为 write timed out（Render 100s 网关限制）
                sys.stderr.write(f'[parse_image] stepfun URLError: {e}\n')
                self._send_json_safe({'error': '识别超时，请换一张更小的图或手动输入'}, 504)
                return
            except Exception as e:
                sys.stderr.write(f'[parse_image] stepfun error: {e}\n')
                self._send_json_safe({'error': f'stepfun error: {e}'}, 502)
                return

            if content:
                self._send_json({'text': content})
            else:
                self._send_json({'error': '模型未返回识别结果，请换一张更清晰的截图或手动输入'}, 422)

        except Exception as e:
            sys.stderr.write(f'[parse_image] exception: {e}\n')
            self._send_json_safe({'error': str(e)}, 500)

    def _send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(data))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # 客户端先断了，无需处理

    def _send_json_safe(self, obj, status=200):
        # 出错路径用：客户端可能已经断开，写响应失败时不要引发连锁异常
        try:
            self._send_json(obj, status)
        except Exception:
            pass

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
