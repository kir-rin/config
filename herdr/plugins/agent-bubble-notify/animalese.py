# 동물의 숲 말투로 한 번 읽기 — hwi-middle/PyAnimalese(MIT)의 소리 파일과 원리를 그대로 쓴다.
# 글자마다 초성을 골라 미리 녹음한 소리(sources/NN.padata, mp3)를 무작위로 피치를 올려 이어 붙이고 wav 로 쓴다.
# 영어 알파벳은 비슷한 초성 소리로(게임처럼 글자마다 소리), 숫자·이모지 등은 건너뛴다.
# 원본 CLI 는 대화형이고 두 번(보통·고음) 틀어서 여기서는 이것만 쓴다.
# 사용: python animalese.py --src <PyAnimalese 폴더> --out <wav> [--high] [--max-chars N] <글>
import argparse
import random
import sys

from pydub import AudioSegment

# PyAnimalese 의 char_list 순서 = sources/01..20.padata
CHARS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ', ' ']
# 완성형 한글의 초성 19개(유니코드 순서) — jamo 패키지 없이 (코드 - 0xAC00) // 588 로 고른다
CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']


# 영어 글자 → 가까운 초성(모음은 ㅇ)
LATIN = dict(zip('abcdefghijklmnopqrstuvwxyz', 'ㅇㅂㅋㄷㅇㅍㄱㅎㅇㅈㅋㄹㅁㄴㅇㅍㅋㄹㅅㅌㅇㅂㅇㅅㅇㅈ'))


def initial(ch):
    code = ord(ch)
    if 0xAC00 <= code <= 0xD7A3:
        return CHOSEONG[(code - 0xAC00) // 588]
    if ch.lower() in LATIN:
        return LATIN[ch.lower()]
    if ch in CHARS:  # 낱자 초성·띄어쓰기
        return ch
    if ch.isspace():
        return ' '
    return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--src', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--high', action='store_true')
    p.add_argument('--max-chars', type=int, default=120)
    p.add_argument('text')
    a = p.parse_args()

    folder = f'{a.src}/sources/high' if a.high else f'{a.src}/sources'
    cache = {}
    result = None
    for ch in a.text[: a.max_chars]:
        key = initial(ch)
        if key is None:
            continue
        if key not in cache:
            cache[key] = AudioSegment.from_mp3(f'{folder}/{str(CHARS.index(key) + 1).zfill(2)}.padata')
        snd = cache[key]
        octaves = 2 * random.uniform(0.96, 1.15)
        pitched = snd._spawn(snd.raw_data, overrides={'frame_rate': int(snd.frame_rate * (2.0 ** octaves))})
        result = pitched if result is None else result + pitched
    if result is None:
        return 2  # 읽을 한글이 없다
    result.export(a.out, format='wav')
    return 0


if __name__ == '__main__':
    sys.exit(main())
