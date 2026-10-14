"""타이어게러지모터스 홈페이지 생성기.

1) 인스타그램 게시물을 가져와 data/posts.json 에 쌓고 사진을 images/ 에 저장
2) index.html, posts/*.html, sitemap.xml, robots.txt 생성

인스타 연결 정보는 환경변수로 받는다 (GitHub 저장소 Secrets 에 등록):
  IG_TOKEN    : 페이스북 페이지 액세스 토큰 (만료 없는 토큰 권장)
  IG_USER_ID  : 인스타 비즈니스 계정 ID
토큰이 없거나 실패해도 이전에 저장된 게시물로 홈페이지는 계속 만들어진다.
"""
from __future__ import annotations

import html
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "posts.json"
IMG_DIR = ROOT / "images"
POST_DIR = ROOT / "posts"
REEL_DIR = ROOT / "reels"
REELS_TXT = ROOT / "data" / "reels.txt"
BLOG_DATA = ROOT / "data" / "blog.json"
BLOG_IMG_MAX = 30  # 블로그마다 최신 글 몇 개까지 사진을 받아둘지
GRAPH = "https://graph.facebook.com/v21.0"
MAX_FETCH = 200


def esc(s) -> str:
    return html.escape(str(s or ""), quote=True)


def filled(v) -> bool:
    """'[ ]' 같은 빈칸 표시나 빈 값이면 False."""
    if isinstance(v, list):
        return any(filled(x) for x in v)
    return bool(v) and "[ ]" not in str(v)


# ---------------------------------------------------------------- 인스타 수집
def fetch_instagram(posts: dict) -> int:
    token, user_id = os.environ.get("IG_TOKEN"), os.environ.get("IG_USER_ID")
    if not token or not user_id:
        print("IG_TOKEN/IG_USER_ID 없음 → 저장된 게시물만 사용")
        return 0
    import requests

    fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp"
    url = f"{GRAPH}/{user_id}/media"
    params = {"fields": fields, "limit": 50, "access_token": token}
    got, new = [], 0
    while url and len(got) < MAX_FETCH:
        r = requests.get(url, params=params, timeout=30)
        if r.status_code != 200:
            print("인스타 조회 실패:", r.status_code, r.text[:300])
            break
        j = r.json()
        got += j.get("data", [])
        url, params = j.get("paging", {}).get("next"), None

    live_ids = set()
    for m in got:
        pid = m["id"]
        live_ids.add(pid)
        img_url = m.get("thumbnail_url") if m.get("media_type") == "VIDEO" else m.get("media_url")
        img_file = IMG_DIR / f"{pid}.jpg"
        if img_url and not img_file.exists():
            try:
                save_image(requests.get(img_url, timeout=60).content, img_file)
            except Exception as e:  # 사진 하나 실패해도 계속
                print("사진 저장 실패", pid, e)
        if pid not in posts:
            new += 1
        posts[pid] = {
            "id": pid,
            "caption": m.get("caption", ""),
            "type": m.get("media_type", ""),
            "permalink": m.get("permalink", ""),
            "timestamp": m.get("timestamp", ""),
            "image": f"images/{pid}.jpg" if img_file.exists() else "",
        }

    # 인스타에서 보관/삭제한 게시물은 홈페이지에서도 내림 (전체 목록을 다 받았을 때만)
    if got and not url:
        for pid in list(posts):
            if pid not in live_ids:
                posts.pop(pid)
                (IMG_DIR / f"{pid}.jpg").unlink(missing_ok=True)
                (POST_DIR / f"{pid}.html").unlink(missing_ok=True)
    print(f"인스타 게시물 {len(got)}개 확인, 새 게시물 {new}개")
    return new


def save_image(raw: bytes, path: Path, size=(1080, 1350)) -> None:
    from PIL import Image

    im = Image.open(io.BytesIO(raw)).convert("RGB")
    im.thumbnail(size)
    IMG_DIR.mkdir(exist_ok=True)
    im.save(path, "JPEG", quality=82, optimize=True, progressive=True)


# ---------------------------------------------------------------- 인스타 릴스
def load_reels(posts: dict) -> list[dict]:
    """data/reels.txt(코드 조회수, 위가 최신) + 인스타 연동으로 받은 릴스. 개인 게시물(exclude.txt)은 뺌."""
    rows = []
    if REELS_TXT.exists():
        for ln in REELS_TXT.read_text(encoding="utf-8").splitlines():
            if ln.strip() and not ln.startswith("#"):
                parts = ln.split()
                rows.append({"code": parts[0], "views": parts[1] if len(parts) > 1 else ""})
    known = {r["code"] for r in rows}
    linked = [p for p in sorted(posts.values(), key=post_date, reverse=True) if "/reel/" in (p.get("permalink") or "")]
    new = [{"code": p["permalink"].rstrip("/").rsplit("/", 1)[-1], "views": ""} for p in linked]
    rows = [r for r in new if r["code"] not in known] + rows
    excludes = load_excludes()
    out = []
    for r in rows:
        if r["code"] in excludes:
            continue
        img = IMG_DIR / f"reel_{r['code']}.jpg"
        if not img.exists():
            try:  # 공개 커버 사진 주소
                import urllib.request
                req = urllib.request.Request(f"https://www.instagram.com/p/{r['code']}/media/?size=l",
                                             headers={"User-Agent": "Mozilla/5.0"})
                save_image(urllib.request.urlopen(req, timeout=30).read(), img, (540, 960))
            except Exception as e:
                print("릴스 커버 저장 실패", r["code"], e)
        r["image"] = f"images/{img.name}" if img.exists() else ""
        out.append(r)
    return out


# ---------------------------------------------------------------- 네이버 블로그 수집
def fetch_blogs(cfg: dict) -> list[dict]:
    """네이버 블로그 RSS에서 최신 글을 모은다. 실패하면 지난번 저장분을 쓴다."""
    import urllib.request
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime

    old = json.loads(BLOG_DATA.read_text(encoding="utf-8")) if BLOG_DATA.exists() else []
    got, ok = [], False
    for b in cfg.get("naver_blogs", []):
        try:
            req = urllib.request.Request(f"https://rss.blog.naver.com/{b['id']}.xml", headers={"User-Agent": "Mozilla/5.0"})
            root = ET.fromstring(urllib.request.urlopen(req, timeout=30).read())
        except Exception as e:
            print("블로그 조회 실패", b["id"], e)
            got += [x for x in old if x.get("blog_id") == b["id"]]
            continue
        ok = True
        for it in root.iter("item"):
            desc = re.sub(r"<[^>]+>", " ", it.findtext("description") or "")
            got.append({
                "blog_id": b["id"],
                "blog": b.get("name", b["id"]),
                "title": (it.findtext("title") or "").strip(),
                "link": (it.findtext("guid") or it.findtext("link") or "").strip(),
                "date": parsedate_to_datetime(it.findtext("pubDate")).strftime("%Y-%m-%d"),
                "summary": re.sub(r"\s+", " ", html.unescape(desc)).strip()[:120],
            })
    if not ok:
        return old
    got.sort(key=lambda x: x["date"], reverse=True)
    old_img = {x["link"]: x.get("image", "") for x in old}
    seen: dict[str, int] = {}
    for b in got:
        n = seen[b["blog_id"]] = seen.get(b["blog_id"], 0) + 1
        b["image"] = old_img.get(b["link"], "")
        if not b["image"] and n <= BLOG_IMG_MAX:
            b["image"] = fetch_blog_image(b)
    BLOG_DATA.parent.mkdir(exist_ok=True)
    BLOG_DATA.write_text(json.dumps(got, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"네이버 블로그 글 {len(got)}개")
    return got


def fetch_blog_image(b: dict) -> str:
    """블로그 글의 대표사진(og:image)을 images/blog_글번호.jpg 로 저장."""
    import urllib.request
    log_no = b["link"].rstrip("/").rsplit("/", 1)[-1]
    path = IMG_DIR / f"blog_{log_no}.jpg"
    if path.exists():
        return f"images/{path.name}"
    try:
        req = urllib.request.Request(f"https://m.blog.naver.com/{b['blog_id']}/{log_no}", headers={"User-Agent": "Mozilla/5.0 (iPhone)"})
        m = re.search(r'property="og:image" content="([^"]+)"', urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore"))
        if not m:
            return ""
        url = html.unescape(m.group(1))
        raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://m.blog.naver.com/"}), timeout=30).read()
        save_image(raw, path, (800, 1000))
        return f"images/{path.name}"
    except Exception as e:
        print("블로그 사진 실패", log_no, e)
        return ""


# ---------------------------------------------------------------- 글 다듬기
TAG_RE = re.compile(r"#[^\s#]+")


def post_title(p: dict, cfg: dict) -> str:
    for line in (p.get("caption") or "").splitlines():
        t = TAG_RE.sub("", line).strip(" .·-|")
        if len(t) >= 4:
            return t[:60]
    return f"{cfg['name']} 작업 사진"


def post_body(p: dict) -> tuple[str, list[str]]:
    cap = p.get("caption") or ""
    tags = [t.lstrip("#") for t in TAG_RE.findall(cap)]
    body = TAG_RE.sub("", cap).strip()
    return body, tags


def post_date(p: dict) -> datetime:
    try:
        return datetime.strptime(p["timestamp"][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except Exception:
        return datetime(2000, 1, 1, tzinfo=timezone.utc)


def load_excludes() -> set[str]:
    f = ROOT / "data" / "exclude.txt"
    if not f.exists():
        return set()
    return {ln.strip() for ln in f.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")}


EXCLUDES: set[str] | None = None


def show_post(cfg: dict, p: dict) -> bool:
    """개인 게시물·글 없는 사진·오래된 게시물은 홈페이지에 안 올림."""
    global EXCLUDES
    if EXCLUDES is None:
        EXCLUDES = load_excludes()
    code = (p.get("permalink") or "").rstrip("/").rsplit("/", 1)[-1]
    if code in EXCLUDES or not (p.get("caption") or "").strip():
        return False
    since = cfg.get("show_posts_since")
    return not since or post_date(p).strftime("%Y-%m-%d") >= since


def abs_url(cfg: dict, path: str) -> str:
    base = cfg["site_url"].rstrip("/") if filled(cfg.get("site_url")) else ""
    return f"{base}/{path}" if base else path


# ---------------------------------------------------------------- 구글용 구조화 데이터
def business_schema(cfg: dict) -> dict:
    links = [v for k, v in cfg.get("links", {}).items() if filled(v) and k != "naver_review"]
    links += [f"https://blog.naver.com/{b['id']}" for b in cfg.get("naver_blogs", [])
              if f"https://blog.naver.com/{b['id']}" not in links]
    d = {
        "@context": "https://schema.org",
        "@type": ["TireShop", "AutoRepair"],
        "name": cfg["name"],
        "alternateName": cfg.get("name_en", ""),
        "description": cfg["description"],
        "sameAs": links,
        "areaServed": ["남양주", "구리", "의정부", "다산", "별내", "진접", "서울 동북부"],
    }
    if filled(cfg.get("site_url")):
        d["url"] = cfg["site_url"]
        d["image"] = abs_url(cfg, "og.jpg")
    phones = [p for p in cfg.get("phones", []) if filled(p)]
    if phones:
        d["telephone"] = phones[0]
    if filled(cfg.get("address")):
        d["address"] = {
            "@type": "PostalAddress",
            "streetAddress": cfg["address"],
            "addressLocality": cfg.get("address_locality", ""),
            "addressRegion": cfg.get("address_region", ""),
            "postalCode": cfg.get("postal_code", ""),
            "addressCountry": "KR",
        }
    if filled(cfg.get("latitude")) and filled(cfg.get("longitude")):
        d["geo"] = {"@type": "GeoCoordinates", "latitude": cfg["latitude"], "longitude": cfg["longitude"]}
    if filled(cfg.get("founding_year")):
        d["foundingDate"] = cfg["founding_year"]
    if cfg.get("hours_schema"):
        d["openingHours"] = cfg["hours_schema"]
    return d


# ---------------------------------------------------------------- HTML 조각
CSS = """
:root{--bg:#141414;--bg2:#1b1b1b;--card:#222;--ink:#f0f0f0;--muted:#a9a9a9;--line:#333;--accent:#e2571e;--dark:#0d0d0d}
*{box-sizing:border-box}body{margin:0;background:var(--bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='48' viewBox='0 0 80 48'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='.045' stroke-width='7' stroke-linecap='round'%3E%3Cpath d='M4 4 L20 24 L4 44'/%3E%3Cpath d='M44 4 L60 24 L44 44'/%3E%3C/g%3E%3C/svg%3E");color:var(--ink);font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.65}
a{color:inherit}img{max-width:100%;display:block}
.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
header.top{background:var(--dark);color:#fff}
header.top .wrap{display:flex;justify-content:space-between;align-items:center;height:60px}
header.top a{text-decoration:none;font-weight:700}
header.top nav a{font-weight:500;margin-left:16px;opacity:.85;font-size:15px}
@media(max-width:600px){header.top .wrap{flex-direction:column;align-items:flex-start;justify-content:center;height:auto;padding-top:10px;padding-bottom:8px}header.top nav a{margin:0 12px 0 0;font-size:14px}}
.hero{background:var(--dark) center/cover no-repeat;color:#fff;padding:96px 0 104px;text-shadow:0 2px 8px #000a}
.hero h1{font-size:clamp(28px,6vw,44px);margin:0 0 10px;line-height:1.25}
.hero p{margin:0 0 24px;opacity:.85;font-size:17px}
.btn{display:inline-block;padding:12px 20px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;margin:4px 6px 4px 0}
.btn.ghost{background:transparent;border:1px solid #fff6}
.calls{margin:16px 0 4px}
section{padding:56px 0}section:nth-of-type(even){background:linear-gradient(#1b1b1bee,#1b1b1bee)}
h2{font-size:26px;margin:0 0 22px;padding-left:14px;border-left:5px solid var(--accent);line-height:1.2}
header.top{border-bottom:3px solid var(--accent)}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--accent);border-radius:12px;padding:20px}
.card h3{margin:0 0 6px;font-size:18px}.card p{margin:0;color:var(--muted)}
.posts{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}
.posts a{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-decoration:none;transition:transform .15s,border-color .15s}
.posts a:hover{transform:translateY(-3px);border-color:var(--accent)}
.posts img{aspect-ratio:4/5;object-fit:cover;width:100%}
.posts span{display:block;padding:8px 10px;font-size:14px;line-height:1.4;height:3.6em;overflow:hidden}
.info dt{font-weight:700;margin-top:12px}.info dd{margin:2px 0 0}
.map{width:100%;height:320px;border:0;border-radius:12px}
footer{background:var(--dark);border-top:3px solid var(--accent);color:#bbb;padding:28px 0;font-size:14px}footer a{margin-right:14px}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin:24px 0}
article img{border-radius:8px;margin:0 auto 16px}
article .body{white-space:pre-line}.tags{color:var(--muted);font-size:14px}
.muted{color:var(--muted)}
.blog a{display:block;text-decoration:none}.blog a:hover .card{border-color:var(--accent)}
.blog small{color:var(--accent);font-weight:700}.blog h3{font-size:16px;line-height:1.45}
.blog p{font-size:14px;margin-top:6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.ig{max-width:935px;margin:0 auto}
.ig-head{display:flex;align-items:center;gap:16px;margin-bottom:16px}
.ig-av{flex:none;width:68px;height:68px;border-radius:50%;padding:3px;background:linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)}
.ig-av span{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:var(--dark);border:3px solid var(--bg);font-weight:800;font-size:20px;color:#fff}
.ig-name{font-weight:700;font-size:17px}.ig-sub{color:var(--muted);font-size:14px}
.ig-follow{margin-left:auto;background:#0095f6;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:8px 18px;border-radius:8px;white-space:nowrap}
.ig-tab{border-top:1px solid var(--line);text-align:center;font-size:13px;font-weight:700;letter-spacing:1px;padding:12px 0 10px}
.reels{display:grid;grid-template-columns:repeat(3,1fr);gap:3px}
@media(min-width:700px){.reels{grid-template-columns:repeat(4,1fr)}}
.reels a{position:relative;display:block;aspect-ratio:9/16;background:#000;overflow:hidden}
.reels img{width:100%;height:100%;object-fit:cover;transition:opacity .15s}.reels a:hover img{opacity:.8}
.reels span{position:absolute;left:8px;bottom:6px;color:#fff;font-size:14px;font-weight:700;text-shadow:0 1px 4px #000}
.reel-modal{position:fixed;inset:0;background:#000d;display:none;align-items:center;justify-content:center;z-index:50;flex-direction:column;gap:10px}
.reel-modal.on{display:flex}.reel-modal iframe{width:min(400px,94vw);height:min(720px,80vh);border:0;border-radius:12px;background:#fff}
.reel-modal button{position:absolute;top:10px;right:14px;background:none;border:0;color:#fff;font-size:36px;cursor:pointer}
.reel-modal a{color:#fff;font-size:14px}
.navbtns{margin-top:20px}.navbtns .btn{background:#03c75a}.navbtns .btn.line{background:transparent;color:var(--ink);border:1px solid var(--line)}
"""


def page(cfg: dict, title: str, desc: str, body: str, path: str, prefix: str = "", extra_ld=None, og_img="og.jpg") -> str:
    ld = [business_schema(cfg)] + ([extra_ld] if extra_ld else [])
    verify = "".join(f'<meta name="{n}" content="{esc(cfg[k])}">' for k, n in (
        ("google_site_verification", "google-site-verification"),
        ("naver_site_verification", "naver-site-verification"),
        ("bing_site_verification", "msvalidate.01")) if filled(cfg.get(k)))
    canon = f'<link rel="canonical" href="{esc(abs_url(cfg, path))}">' if filled(cfg.get("site_url")) else ""
    og = abs_url(cfg, og_img)
    return f"""<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc[:155])}">
<meta name="keywords" content="{esc(cfg.get('keywords', ''))}">
{verify}{canon}
<meta property="og:type" content="website"><meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc[:155])}"><meta property="og:image" content="{esc(og)}">
<meta property="og:locale" content="ko_KR">
<link rel="alternate" type="application/rss+xml" title="{esc(cfg['name'])}" href="{prefix}rss.xml">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
<style>{CSS}</style>
</head><body>
<header class="top"><div class="wrap"><a href="{prefix}index.html">{esc(cfg['name'])}</a>
<nav><a href="{prefix}index.html#services">작업</a><a href="{prefix}posts/index.html">작업사례</a><a href="{prefix}reels/index.html">릴스</a><a href="{prefix}index.html#reviews">후기</a><a href="{prefix}index.html#contact">오시는 길</a></nav></div></header>
{body}
{footer(cfg)}
</body></html>"""


def footer(cfg: dict) -> str:
    names = {"instagram": "인스타그램", "facebook": "페이스북", "naver_place": "네이버 플레이스",
             "naver_review": "네이버 리뷰", "naver_blog": "네이버 블로그", "google_maps": "구글 지도", "youtube": "유튜브"}
    links = " ".join(f'<a href="{esc(u)}" rel="noopener" target="_blank">{names.get(k, k)}</a>'
                     for k, u in cfg.get("links", {}).items() if filled(u))
    addr = esc(cfg["address"]) if filled(cfg.get("address")) else ""
    return f'<footer><div class="wrap"><p>{links}</p><p>{esc(cfg["name"])} {addr}</p></div></footer>'


SHORT_NAME_RE = re.compile(r"타이어\s?게러지(\s?모터스)?")


def full_name(t: str) -> str:
    """블로그 제목의 '타이어게러지'를 상호 '타이어게러지모터스'로 통일해 보여줌."""
    return SHORT_NAME_RE.sub("타이어게러지모터스", t)


def work_items(cfg: dict, posts: list[dict], blogs: list[dict]) -> list[dict]:
    """작업사례 목록 = 인스타 게시물(홈페이지 안 페이지) + 사진 있는 블로그 글(블로그로 연결)."""
    # 인스타·블로그별로 최신순 줄을 만든 뒤 한 개씩 번갈아 섞음 (한 곳만 몰려 나오지 않게)
    lanes = [[{"date": post_date(p).strftime("%Y-%m-%d"), "title": post_title(p, cfg), "image": p.get("image", ""),
               "href": f"posts/{p['id']}.html", "ext": False} for p in posts]]
    for bl in cfg.get("naver_blogs", []):
        lanes.append([{"date": b["date"], "title": full_name(b["title"]), "image": b["image"], "href": b["link"], "ext": True}
                      for b in blogs if b.get("image") and b["blog_id"] == bl["id"]])
    items = []
    for row in range(max(map(len, lanes))):
        items += sorted((ln[row] for ln in lanes if row < len(ln)), key=lambda x: x["date"], reverse=True)
    return items


def post_cards(cfg: dict, items: list[dict], prefix: str) -> str:
    out = []
    for it in items:
        img = f'<img src="{prefix}{esc(it["image"])}" alt="{esc(it["title"])}" loading="lazy">' if it.get("image") else ""
        href = esc(it["href"]) if it["ext"] else f'{prefix}{esc(it["href"])}'
        tgt = ' target="_blank" rel="noopener"' if it["ext"] else ""
        out.append(f'<a href="{href}"{tgt}>{img}<span>{esc(it["title"])}</span></a>')
    return '<div class="posts">' + "".join(out) + "</div>"


def reel_grid(cfg: dict, reels: list[dict], prefix: str, total: int) -> str:
    """인스타그램 프로필 화면처럼 보이는 릴스 칸. 누르면 홈페이지 안에서 바로 재생."""
    ig = cfg.get("links", {}).get("instagram", "")
    handle = ig.rstrip("/").rsplit("/", 1)[-1] if ig else ""
    tiles = "".join(
        f'<a href="https://www.instagram.com/reel/{esc(r["code"])}/" data-code="{esc(r["code"])}" target="_blank" rel="noopener">'
        f'<img src="{prefix}{esc(r["image"])}" alt="{esc(cfg["name"])} 작업 영상" loading="lazy">'
        + (f'<span>▷ {esc(r["views"])}</span>' if r.get("views") else "") + "</a>"
        for r in reels if r.get("image"))
    follow = f'<a class="ig-follow" href="{esc(ig)}" target="_blank" rel="noopener">팔로우</a>' if ig else ""
    return f"""<div class="ig"><div class="ig-head"><div class="ig-av"><span>TG</span></div>
<div><div class="ig-name">{esc(handle)}</div><div class="ig-sub">{esc(cfg['name'])} · 릴스 {total}개</div></div>{follow}</div>
<div class="ig-tab">▶ 릴스</div><div class="reels">{tiles}</div></div>
<div class="reel-modal" id="reelModal"><button aria-label="닫기">×</button><iframe title="인스타그램 릴스" allow="autoplay; encrypted-media" allowfullscreen></iframe><a target="_blank" rel="noopener">인스타그램에서 보기 ›</a></div>
<script>(function(){{var m=document.getElementById('reelModal'),f=m.querySelector('iframe'),l=m.querySelector('a');
function close(){{m.classList.remove('on');f.src='about:blank'}}
document.querySelectorAll('.reels a').forEach(function(a){{a.addEventListener('click',function(e){{e.preventDefault();
f.src='https://www.instagram.com/reel/'+a.dataset.code+'/embed/captioned/';l.href=a.href;m.classList.add('on')}})}});
m.addEventListener('click',function(e){{if(e.target!==f&&e.target!==l)close()}});document.addEventListener('keydown',function(e){{if(e.key==='Escape')close()}})}})();</script>"""


def ext(url: str, label: str, cls: str = "btn") -> str:
    return f'<a class="{cls}" href="{esc(url)}" target="_blank" rel="noopener">{label}</a>' if filled(url) else ""


def blog_buttons(cfg: dict) -> str:
    return "".join(ext(f"https://blog.naver.com/{b['id']}", f"블로그 {esc(b.get('name', b['id']))}", "btn line")
                   for b in cfg.get("naver_blogs", []))


def blog_section(cfg: dict) -> str:
    links = cfg.get("links", {})
    btns = (ext(links.get("naver_review"), "네이버 방문자 리뷰 보기")
            + ext(cfg.get("naver_booking") or links.get("naver_place"), "네이버 예약·길찾기")
            + blog_buttons(cfg))
    return (f'<section id="reviews"><div class="wrap"><h2>고객 후기 · 블로그</h2>'
            f'<p class="muted">방문 고객 리뷰는 네이버에서 확인하세요. 블로그에 새 작업 후기를 쓰면 위 작업사례에도 자동으로 올라옵니다.</p>'
            f'<div class="navbtns">{btns}</div></div></section>')


def latest_photo(cfg: dict, posts: list[dict], blogs: list[dict], reels: list[dict]) -> str:
    """가장 최근에 올린 사진: 인스타 게시물·블로그 글 중 최신 → 없으면 최신 릴스 커버 → 기본 사진."""
    for it in work_items(cfg, posts, blogs):
        if it.get("image") and (ROOT / it["image"]).exists():
            return it["image"]
    for r in reels:
        if r.get("image"):
            return r["image"]
    return "hero_default.jpg"


def build_index(cfg: dict, posts: list[dict], blogs: list[dict], reels: list[dict]) -> str:
    phones = [p for p in cfg.get("phones", []) if filled(p)]
    labels = cfg.get("phone_labels", [])
    named = [(labels[i] + " " if i < len(labels) and filled(labels[i]) else "", p) for i, p in enumerate(phones)]
    call = ('<div class="calls">' + "".join(f'<a class="btn" href="tel:{esc(p)}">📞 {esc(n)}{esc(p)}</a>' for n, p in named) + "</div>") if phones else ""
    links = cfg["links"]
    book = (ext(cfg.get("naver_booking") or links.get("naver_place"), "네이버 예약", "btn ghost")
            + ext(links.get("naver_review"), "네이버 리뷰", "btn ghost"))
    svc = "".join(f'<div class="card"><h3>{esc(s["title"])}</h3><p>{esc(s["text"])}</p></div>' for s in cfg["services"])

    recent = work_items(cfg, posts, blogs)[: int(cfg.get("posts_on_home", 12))]
    posts_html = (post_cards(cfg, recent, "") + '<p style="margin-top:16px"><a class="btn" href="posts/index.html">작업사례 전체 보기</a></p>'
                  if recent else '<p class="muted">작업 사진이 곧 올라옵니다.</p>')

    n_reels = int(cfg.get("reels_on_home", 12))
    reels_html = (f'<section id="reels"><div class="wrap"><h2>릴스 · 작업 영상</h2>{reel_grid(cfg, reels[:n_reels], "", len(reels))}'
                  f'<p style="margin-top:16px"><a class="btn" href="reels/index.html">릴스 전체 보기 ({len(reels)}개)</a></p></div></section>'
                  if reels else "")

    info = []
    if filled(cfg.get("address")):
        jibun = f'<br><span class="muted">(지번) {esc(cfg["address_jibun"])}</span>' if filled(cfg.get("address_jibun")) else ""
        info.append(f"<dt>주소</dt><dd>{esc(cfg['address'])}{jibun}</dd>")
    if phones:
        info.append("<dt>전화</dt><dd>" + "<br>".join(f'{esc(n)}<a href="tel:{esc(p)}">{esc(p)}</a>' for n, p in named) + "</dd>")
    hours = [h for h in cfg.get("hours", []) if filled(h.get("time"))]
    if hours:
        info.append("<dt>영업시간</dt><dd>" + "<br>".join(f"{esc(h['days'])} {esc(h['time'])}" for h in hours) + "</dd>")
    mapq = cfg["address"] if filled(cfg.get("address")) else ""
    mp = (f'<iframe class="map" loading="lazy" title="지도" src="https://www.google.com/maps?q={esc(mapq)}&output=embed"></iframe>'
          if mapq else "")

    # 맨 위 배경: 인스타 최신 사진, 없으면 기본 사진
    hero_img = latest_photo(cfg, posts, blogs, reels)  # 매일 2번 빌드 때마다 최신 사진으로 바뀜
    hero_bg = f'background-image:linear-gradient(90deg,#000c 0%,#0008 55%,#0003 100%),url({esc(hero_img)})'
    body = f"""
<div class="hero" style="{hero_bg}"><div class="wrap">
<h1>{esc(cfg['name'])}</h1><p>{esc(cfg['tagline'])}</p>{call}{book}
</div></div>
<section><div class="wrap"><h2>매장 소개</h2><p>{esc(cfg['description'])}</p></div></section>
<section id="services"><div class="wrap"><h2>주요 작업</h2><div class="grid">{svc}</div></div></section>
<section><div class="wrap"><h2>최근 작업사례</h2>{posts_html}</div></section>
{reels_html}
{blog_section(cfg)}
<section id="contact"><div class="wrap"><h2>오시는 길 · 문의</h2>
<div class="grid"><dl class="info card">{''.join(info) or '<dd class="muted">준비 중</dd>'}</dl>{mp}</div></div></section>"""
    return page(cfg, f"{cfg['name']} | {cfg['tagline']}", cfg["description"], body, "")


def build_post(cfg: dict, p: dict) -> str:
    title = post_title(p, cfg)
    body_txt, tags = post_body(p)
    img = f'<img src="../{esc(p["image"])}" alt="{esc(title)}">' if p.get("image") else ""
    d = post_date(p)
    ig = f'<p><a href="{esc(p["permalink"])}" target="_blank" rel="noopener">인스타그램에서 보기</a></p>' if p.get("permalink") else ""
    body = f"""<div class="wrap"><article>{img}
<h1 style="font-size:24px">{esc(title)}</h1><p class="muted">{d:%Y.%m.%d}</p>
<div class="body">{esc(body_txt)}</div>
<p class="tags">{' '.join('#' + esc(t) for t in tags)}</p>{ig}
<p><a class="btn" href="../index.html#contact">문의·오시는 길</a></p></article></div>"""
    ld = {"@context": "https://schema.org", "@type": "BlogPosting", "headline": title,
          "datePublished": p.get("timestamp", ""), "author": {"@type": "Organization", "name": cfg["name"]},
          "keywords": ", ".join(tags)}
    if p.get("image"):
        ld["image"] = abs_url(cfg, p["image"])
    desc = (body_txt.replace("\n", " ") or title)
    return page(cfg, f"{title} | {cfg['name']}", desc, body, f"posts/{p['id']}.html", "../", ld, p.get("image") or "og.jpg")


def build_post_list(cfg: dict, posts: list[dict], blogs: list[dict]) -> str:
    items = work_items(cfg, posts, blogs)
    more = blog_buttons(cfg)
    body = (f'<div class="wrap"><section><h2>작업사례</h2>{post_cards(cfg, items, "../") if items else "<p>준비 중</p>"}'
            f'<div class="navbtns">{more}</div></section></div>')
    return page(cfg, f"작업사례 | {cfg['name']}", f"{cfg['name']} 타이어 교체·정비·오프로드 튜닝 작업사례 모음", body, "posts/index.html", "../")


def build_reel_list(cfg: dict, reels: list[dict]) -> str:
    body = f'<div class="wrap"><section><h2>릴스 · 작업 영상</h2>{reel_grid(cfg, reels, "../", len(reels))}</section></div>'
    return page(cfg, f"릴스 | {cfg['name']}", f"{cfg['name']} 타이어 교체·리프트업·오프로드 튜닝 작업 영상 모음", body, "reels/index.html", "../")


def build_sitemap(cfg: dict, posts: list[dict]) -> str:
    if not filled(cfg.get("site_url")):
        return ""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urls = [(abs_url(cfg, ""), today), (abs_url(cfg, "posts/index.html"), today), (abs_url(cfg, "reels/index.html"), today)]
    urls += [(abs_url(cfg, f"posts/{p['id']}.html"), post_date(p).strftime("%Y-%m-%d")) for p in posts]
    rows = "".join(f"<url><loc>{esc(u)}</loc><lastmod>{d}</lastmod></url>" for u, d in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</urlset>'


def build_rss(cfg: dict, posts: list[dict]) -> str:
    """네이버 서치어드바이저 RSS 제출용."""
    from email.utils import format_datetime
    items = []
    for p in posts[:50]:
        u = esc(abs_url(cfg, f"posts/{p['id']}.html"))
        items.append(f"<item><title>{esc(post_title(p, cfg))}</title><link>{u}</link><guid>{u}</guid>"
                     f"<pubDate>{format_datetime(post_date(p))}</pubDate><description>{esc(post_body(p)[0][:300])}</description></item>")
    return (f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>{esc(cfg["name"])}</title>'
            f'<link>{esc(abs_url(cfg, ""))}</link><description>{esc(cfg["description"])}</description>'
            f'<language>ko</language>{"".join(items)}</channel></rss>')


# ---------------------------------------------------------------- 실행
def main() -> int:
    cfg = json.loads((ROOT / "site_config.json").read_text(encoding="utf-8"))
    posts = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {}
    fetch_instagram(posts)
    blogs = fetch_blogs(cfg)
    DATA.parent.mkdir(exist_ok=True)
    DATA.write_text(json.dumps(posts, ensure_ascii=False, indent=1), encoding="utf-8")

    ordered = [p for p in sorted(posts.values(), key=post_date, reverse=True) if show_post(cfg, p)]
    for p in posts.values():  # 제외된 게시물의 예전 페이지 정리
        if p not in ordered:
            (POST_DIR / f"{p['id']}.html").unlink(missing_ok=True)

    reels = load_reels(posts)
    # 대표 이미지(og.jpg, 카톡 미리보기): 가장 최근 사진
    og_src = ROOT / latest_photo(cfg, ordered, blogs, reels)
    if og_src.exists():
        (ROOT / "og.jpg").write_bytes(og_src.read_bytes())
    POST_DIR.mkdir(exist_ok=True)
    REEL_DIR.mkdir(exist_ok=True)
    (ROOT / "index.html").write_text(build_index(cfg, ordered, blogs, reels), encoding="utf-8")
    (REEL_DIR / "index.html").write_text(build_reel_list(cfg, reels), encoding="utf-8")
    (POST_DIR / "index.html").write_text(build_post_list(cfg, ordered, blogs), encoding="utf-8")
    for p in ordered:
        (POST_DIR / f"{p['id']}.html").write_text(build_post(cfg, p), encoding="utf-8")

    sm = build_sitemap(cfg, ordered)
    robots = "User-agent: *\nAllow: /\n"
    if sm:
        (ROOT / "sitemap.xml").write_text(sm, encoding="utf-8")
        robots += f"Sitemap: {abs_url(cfg, 'sitemap.xml')}\n"
    (ROOT / "robots.txt").write_text(robots, encoding="utf-8")
    if filled(cfg.get("site_url")):
        (ROOT / "rss.xml").write_text(build_rss(cfg, ordered), encoding="utf-8")
    (ROOT / ".nojekyll").write_text("", encoding="utf-8")
    print(f"홈페이지 생성 완료: 게시물 {len(ordered)}개, 릴스 {len(reels)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
