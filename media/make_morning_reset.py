"""아침 뇌 리셋 60초 영상 생성기 (1080x1920, 30fps, 스테레오 48kHz).

오디오 구성 (40~60대 청력 고려: 고음역 4kHz 이상은 거의 쓰지 않음)
- 바이노럴 비트: 좌 200Hz / 우 200+비트Hz. 비트 10Hz(알파) -> 15Hz(저베타)로 서서히 상승
- 저음 패드 화음(110/165/220/275Hz): 호흡(들숨 4초·날숨 6초)에 맞춰 부풀었다 가라앉음
- 저역 필터 핑크노이즈: 파도처럼 호흡에 맞춰 출렁임, 후반으로 갈수록 줄어듦
- 마지막 종소리(660Hz)로 마무리
"""
import subprocess, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, DUR, SR = 1080, 1920, 30, 60, 48000
OUT = sys.argv[1] if len(sys.argv) > 1 else "morning_brain_reset.mp4"
FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
CYCLE, INHALE = 10.0, 4.0   # 분당 6회 공명 호흡
BREATH_START, BREATH_END = 4.0, 56.0

def breath(t):
    """0(완전 날숨)~1(완전 들숨), 단계 문자열"""
    if t < BREATH_START or t >= BREATH_END:
        return 0.0, ""
    p = (t - BREATH_START) % CYCLE
    if p < INHALE:
        return 0.5 - 0.5 * np.cos(np.pi * p / INHALE), "들이쉬고"
    return 0.5 + 0.5 * np.cos(np.pi * (p - INHALE) / (CYCLE - INHALE)), "내쉬고"

def beat_hz(t):
    if t < 22: return 10.0
    if t < 40: return 10.0 + 5.0 * (t - 22) / 18
    return 15.0

# ---------------- 오디오 ----------------
n = SR * DUR
t = np.arange(n) / SR
br = np.array([breath(x)[0] for x in t[::SR // 100]])
br = np.interp(t, t[::SR // 100], br)
br = np.where((t >= BREATH_START) & (t < BREATH_END), br, 0.0)

carrier = 200.0
bh = np.vectorize(beat_hz)(t[::SR // 100]); bh = np.interp(t, t[::SR // 100], bh)
phase_r = 2 * np.pi * np.cumsum(carrier + bh) / SR
L = np.sin(2 * np.pi * carrier * t) * 0.18
R = np.sin(phase_r) * 0.18

pad = sum(a * np.sin(2 * np.pi * f * t + i) for i, (f, a) in
          enumerate([(110, .10), (165, .07), (220, .06), (275, .035)]))
pad *= 0.55 + 0.45 * br

rng = np.random.default_rng(7)
wn = rng.standard_normal(n)
spec = np.fft.rfft(wn); f = np.fft.rfftfreq(n, 1 / SR)
spec /= np.sqrt(np.maximum(f, 20)); spec[f > 1800] *= np.exp(-(f[f > 1800] - 1800) / 600)
pink = np.fft.irfft(spec, n); pink /= np.abs(pink).max()
noise_lvl = np.interp(t, [0, 22, 45, 60], [0.16, 0.12, 0.06, 0.04])
noise = pink * noise_lvl * (0.3 + 0.7 * br)

bell = np.zeros(n); tb = t - 56.5; m = tb >= 0
bell[m] = (np.sin(2*np.pi*660*tb[m]) + .4*np.sin(2*np.pi*1320*tb[m])) * np.exp(-tb[m] / 1.2) * 0.22

env = np.clip(np.minimum(t / 3.0, (DUR - t) / 2.5), 0, 1)
left = (L + pad + noise + bell) * env
right = (R + pad + noise + bell) * env
st = np.stack([left, right], 1); st /= np.abs(st).max() / 0.85
wav = "morning_audio.wav"
import wave
with wave.open(wav, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())

# ---------------- 영상 ----------------
f_big = ImageFont.truetype(FONT, 86); f_mid = ImageFont.truetype(FONT, 54)
f_sm = ImageFont.truetype(FONT, 40); f_xs = ImageFont.truetype(FONT, 32)
yy = np.linspace(0, 1, H)[:, None, None]

def lerp(a, b, k): return tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
# 새벽 남색 -> 아침 하늘색/햇살
TOP = [(14, 20, 48), (40, 70, 120), (110, 170, 215)]
BOT = [(40, 30, 70), (190, 120, 110), (250, 205, 150)]
def grad_at(k):
    i = min(int(k * 2), 1); kk = k * 2 - i
    return lerp(TOP[i], TOP[i+1], kk), lerp(BOT[i], BOT[i+1], kk)

def stage(tt):
    if tt < 22: return "1단계 · 머릿속 비우기", "알파파 10Hz · 긴장 풀기"
    if tt < 40: return "2단계 · 깨어나기", "10Hz → 15Hz 서서히 상승"
    return "3단계 · 집중 모드", "저베타파 15Hz · 맑은 정신"

def ctext(d, y, s, font, fill):
    w = d.textlength(s, font=font); d.text(((W - w) / 2, y), s, font=font, fill=fill)

ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
    "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", wav, "-c:v", "libx264", "-preset", "medium",
    "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest",
    "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)

for fi in range(FPS * DUR):
    tt = fi / FPS; k = tt / DUR
    top, bot = grad_at(k)
    arr = (np.array(top)[None, None] * (1 - yy) + np.array(bot)[None, None] * yy)
    arr = np.broadcast_to(arr, (H, W, 3)).astype(np.uint8)
    img = Image.fromarray(arr.copy()); d = ImageDraw.Draw(img, "RGBA")

    b, word = breath(tt)
    cx, cy = W // 2, 1000
    # 떠오르는 해 느낌의 호흡 원
    r = 170 + 190 * b
    for g in range(6, 0, -1):
        rr = r + g * 28; a = int(18 * (7 - g) / 6)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(255, 235, 190, a))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 240, 210, 150), outline=(255, 255, 255, 200), width=4)

    if tt < 4:
        al = int(255 * min(1, tt / 1.0, (4 - tt) / 0.8))
        ctext(d, 420, "아침 뇌 리셋 60초", f_big, (255, 255, 255, al))
        ctext(d, 540, "출근 전, 머리를 맑게", f_mid, (255, 255, 255, al))
        ctext(d, 1500, "이어폰(양쪽) 착용을 권장합니다", f_sm, (255, 255, 255, al))
        ctext(d, 1565, "편하게 앉아 어깨 힘을 빼세요", f_sm, (255, 255, 255, al))
    elif tt < BREATH_END:
        s1, s2 = stage(tt)
        ctext(d, 300, s1, f_mid, (255, 255, 255, 235))
        ctext(d, 380, s2, f_sm, (255, 255, 255, 200))
        p = (tt - BREATH_START) % CYCLE
        sec = int(INHALE - p) + 1 if p < INHALE else int(CYCLE - p) + 1
        ctext(d, cy - 70, word, f_mid, (60, 50, 70, 240))
        ctext(d, cy + 10, str(sec), f_big, (60, 50, 70, 230))
        ctext(d, 1520, "코로 4초 들이쉬고 · 입으로 6초 내쉬기", f_sm, (255, 255, 255, 220))
        # 진행 바
        prog = (tt - BREATH_START) / (BREATH_END - BREATH_START)
        d.rounded_rectangle([140, 1700, W - 140, 1712], 6, fill=(255, 255, 255, 70))
        d.rounded_rectangle([140, 1700, 140 + (W - 280) * prog, 1712], 6, fill=(255, 255, 255, 220))
    else:
        al = int(255 * min(1, (tt - BREATH_END) / 1.0, (DUR - tt) / 1.0))
        ctext(d, 420, "좋은 하루 시작하세요", f_big, (255, 255, 255, al))
        ctext(d, 540, "오늘도 맑은 머리로", f_mid, (255, 255, 255, al))
    ctext(d, 1830, "※ 의료 치료가 아닌 휴식·컨디션 관리용 사운드입니다", f_xs, (255, 255, 255, 150))
    ff.stdin.write(img.convert("RGB").tobytes())

ff.stdin.close(); ff.wait()
print("done", OUT)
