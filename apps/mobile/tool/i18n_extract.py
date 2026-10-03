"""Every user-facing string this app shows that is not yet translatable.

Companion to `i18n_rewrite.py`. That script wraps what the dictionary already knows; this one finds
what the dictionary is missing, which is the half that was wrong the first time round — a rewrite
that only wraps known strings will happily leave a screen entirely in English and report success.

Interpolated strings are listed separately and not offered for translation. Tamil is verb-final, so
a fragment either side of a `${}` cannot be translated in isolation without the sentence coming out
backwards; those need whole-message formatting, which this app does not have yet.

Run:  python tool/i18n_extract.py > missing.txt
"""

import io
import json
import os
import re
import sys

ROOT = 'lib'
DICT = 'lib/core/i18n_ta.dart'

# The widgets and named parameters this app puts words on screen with.
PATTERNS = [
    re.compile(r"\b(?:Text|_Label|SectionLabel)\(\s*('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")"),
    re.compile(
        r"\b(?:hintText|labelText|title|body|label|helperText|tooltip|message|addLabel|confirmLabel)"
        r":\s*('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")"
    ),
]
WORD = re.compile(r'[A-Za-z]{3}')


def known():
    source = io.open(DICT, encoding='utf-8').read()
    return set(re.findall(r"^  '((?:[^'\\]|\\.)*)':", source, re.M))


def unescape(value):
    return value.replace("\\'", "'").replace('\\"', '"').replace('\\\\', '\\')


def main():
    have = known()
    plain, interpolated = {}, set()

    for base, _, names in os.walk(ROOT):
        for name in names:
            if not name.endswith('.dart') or name.startswith('i18n'):
                continue
            path = os.path.join(base, name)
            src = io.open(path, encoding='utf-8', errors='ignore').read()

            for pattern in PATTERNS:
                for match in pattern.finditer(src):
                    literal = unescape(match.group(1)[1:-1])
                    if not WORD.search(literal) or literal.startswith('images/'):
                        continue
                    if literal in have:
                        continue
                    if '$' in literal:
                        interpolated.add(literal)
                    else:
                        plain.setdefault(literal, []).append(
                            os.path.relpath(path, ROOT).replace(os.sep, '/')
                        )

    out = sys.argv[1] if len(sys.argv) > 1 else 'missing.json'
    io.open(out, 'w', encoding='utf-8').write(
        json.dumps({k: sorted(set(v)) for k, v in sorted(plain.items())}, ensure_ascii=False, indent=1)
    )
    print(f'{len(plain)} translatable, {len(interpolated)} interpolated (left in English)')
    print(f'written to {out}')


if __name__ == '__main__':
    main()
