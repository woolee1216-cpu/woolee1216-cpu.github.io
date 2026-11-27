"""릴스 글(인스타 캡션) → 홈페이지용 릴스 제목·설명 (data/reels_meta.json).

AI 검색(ChatGPT·제미나이·구글 AI)은 영상을 보지 않고 글만 읽는다.
그래서 릴스 페이지에 릴스마다 "무슨 차, 무슨 작업"인지 글로 적어 둔다.

실행(이 컴퓨터에서): python tools/make_reels_meta.py
 - reels_maker/reels_export/reels.json, reels_maker/upload_queue.json 의 캡션을 읽음
 - 전화번호·주소·해시태그·인사말은 빼고 제목 1줄 + 설명 2줄만 남김
 - 홈페이지 data/reels.txt 에 없는 새 릴스 코드는 맨 위에 추가
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HP = Path(__file__).resolve().parents[1]
RM = HP.parents[1] / "reels_maker"
OUT = HP / "data" / "reels_meta.json"
REELS_TXT = HP / "data" / "reels.txt"

SKIP = re.compile(r"안녕하세요|매장에 새로운 차량|타이어게러지\s?모터스입니다|타이어게러지\s?모터스$|상담은 전화|전화|문의|DM|010|"
                  r"경기도|남양주시|진접읍|금곡리|TIREGARAGE|작업기$|^감사합니다|^[A-Za-z ,.'’()\-!/0-9]+$")
EMOJI = re.compile(r"[\U0001F000-\U0001FFFF☀-➿️]")


def clean(line: str) -> str:
    line = EMOJI.sub("", line)
    line = re.sub(r"#\S+", "", line)
    line = re.sub(r"^\s*([①-⑳]|\d{1,2}[.)]|[-–•✔·]|0\d)\s*", "", line)
    return re.sub(r"\s+", " ", line).strip(" ·-|")


def lines_of(caption: str) -> list[str]:
    body = caption.split("TIREGARAGEMOTORS")[0]
    out = []
    for ln in body.splitlines():
        c = clean(ln)
        if len(c) < 4 or SKIP.search(c):
            continue
        out.append(c)
    return out


def short(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def yt_title(t: str) -> str:
    """'차종 · 작업 | 남양주 타이어게러지모터스 #Shorts' 형식이면 앞부분이 가장 좋은 제목."""
    if "남양주" not in t:
        return ""
    return re.sub(r"\s*#shorts\s*", "", t.split("|")[0], flags=re.I).strip()


def main() -> int:
    caps: dict[str, dict] = {}
    for src in (RM / "reels_export" / "reels.json", RM / "upload_queue.json"):
        if not src.exists():
            continue
        for x in json.loads(src.read_text(encoding="utf-8")):
            d = caps.setdefault(x["code"], {})
            d.setdefault("caption", x.get("caption") or "")
            d.setdefault("date", x.get("date") or x.get("ig_date") or "")
            if x.get("title"):
                d["yt"] = x["title"]
    meta = {}
    for code, d in caps.items():
        ls = lines_of(d["caption"])
        title = yt_title(d.get("yt", "")) or (ls[0] if ls else "")
        rest = [l for l in ls if l != title and l not in title]
        if not title or not re.fullmatch(r"[A-Za-z0-9_-]{11}", code):
            continue
        meta[code] = {"title": short(title, 70), "desc": short(" · ".join(rest[:3]), 170), "date": d["date"]}
    OUT.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    # 홈페이지에 아직 없는 새 릴스 → reels.txt 맨 위(최신순)
    txt = REELS_TXT.read_text(encoding="utf-8").splitlines()
    head = [l for l in txt if l.startswith("#")]
    rows = [l for l in txt if l.strip() and not l.startswith("#")]
    known = {l.split()[0] for l in rows}
    new = sorted((c for c in meta if c not in known and meta[c]["date"]), key=lambda c: meta[c]["date"], reverse=True)
    if new:
        REELS_TXT.write_text("\n".join(head + [f"{c} 0" for c in new] + rows) + "\n", encoding="utf-8")
    print(f"릴스 설명 {len(meta)}개 저장, 새 릴스 {len(new)}개 추가")
    return 0


if __name__ == "__main__":
    sys.exit(main())
