#!/usr/bin/env python3
"""초안 속 “…” 인용이 원문 파일에 글자 그대로 있는지 확인한다.

사용: python3 -I quote_check.py <초안 파일> <원문 폴더 또는 파일>...
- 인용은 “ ” 로 감싼 것만 본다(곧은따옴표 " 는 코드·문구 예시와 섞여 보지 않는다).
- 비교 전에 공백을 하나로 줄이고, Slack 서식(*굵게*, _기울임_, `코드`, <url|글자>)을 벗긴다.
- JSON 원문은 문자열 값만 모아 비교한다(이스케이프된 \\n 등 때문).
종료 코드: 모두 찾으면 0, 하나라도 못 찾으면 1.
"""
import json
import os
import re
import sys


def norm(text):
    text = re.sub(r'<(?:https?://|mailto:)[^|>]*\|([^>]*)>', r'\1', text)
    text = re.sub(r'<@[A-Z0-9]+>', '', text)
    text = re.sub(r'[*_`]', '', text)
    text = text.replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")
    return re.sub(r'\s+', ' ', text).strip()


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)


def load(path):
    raw = open(path, encoding='utf-8', errors='ignore').read()
    if path.endswith('.json'):
        try:
            return '\n'.join(strings(json.loads(raw)))
        except ValueError:
            pass
    return raw


def source_files(args):
    for a in args:
        if os.path.isdir(a):
            for root, _, files in os.walk(a):
                for f in sorted(files):
                    yield os.path.join(root, f)
        else:
            yield a


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    draft = open(sys.argv[1], encoding='utf-8').read()
    corpus = {p: norm(load(p)) for p in source_files(sys.argv[2:])}
    quotes = re.findall(r'“([^”]{4,})”', draft)
    missing = 0
    for q in quotes:
        nq = norm(q)
        hits = [os.path.basename(p) for p, t in corpus.items() if nq in t]
        if hits:
            print(f'OK    “{q[:60]}” ← {", ".join(hits)}')
        else:
            missing += 1
            print(f'MISS  “{q[:60]}”')
    print(f'\n인용 {len(quotes)}개 · 원문에서 찾음 {len(quotes) - missing} · 못 찾음 {missing}')
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())
