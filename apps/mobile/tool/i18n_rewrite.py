"""Wraps the app's user-facing Dart strings in t(), and drops the `const` that would forbid it.

Narrower than the web rewriter on purpose. Dart has no JSX, so there is no general "this is text on
screen" shape to look for — but the ways this app puts words on screen are few and consistent:
`Text('…')`, and a handful of named parameters that carry prose. Matching only those, and only for
strings that already have a translation, is what makes a regex safe enough here where it was not
safe at all for TSX.

The hazard is `const`. `const Text('Sites')` is a compile-time constant and `t('Sites')` is a
function call, so wrapping without removing the `const` breaks the file — and the `const` is often
on an ancestor (`const Column(children: [Text('Sites')])`), where finding it by counting brackets is
guesswork. So this does not guess: it wraps, asks the analyser which `const` keywords are now
invalid, removes exactly those, and repeats until the analyser is happy. The compiler knows where
the brackets are.

Run:  python tool/i18n_rewrite.py [--apply]
"""

import io
import os
import re
import subprocess
import sys

APPLY = '--apply' in sys.argv
ROOT = 'lib'
DICT_PATH = 'lib/core/i18n_ta.dart'

# The named parameters that carry prose a person reads. Anything not here is left alone.
PROSE_PARAMS = ('hintText', 'labelText', 'title', 'body', 'label', 'helperText', 'tooltip', 'message')


def line_starts(source):
    """Absolute offset of the start of each line, so the analyser's line:column can be used."""
    starts = [0]
    for index, char in enumerate(source):
        if char == chr(10):
            starts.append(index + 1)
    return starts


def load_keys():
    """The English side of the dictionary: the only strings worth wrapping."""
    source = io.open(DICT_PATH, encoding='utf-8').read()
    return set(re.findall(r"^  '((?:[^'\\]|\\.)*)':", source, re.M))


def unescape(value):
    return value.replace("\\'", "'").replace('\\\\', '\\').replace(r'\$', '$')


def rewrite(source, keys):
    count = [0]

    def wrap(match):
        prefix, quote, body = match.group(1), match.group(2), match.group(3)
        if unescape(body) not in keys:
            return match.group(0)
        count[0] += 1
        return '%st(%s%s%s)' % (prefix, quote, body, quote)

    source = re.sub(r"(\bText\(\s*)(['\"])((?:[^'\"\\]|\\.)*?)\2", wrap, source)
    # `_Label('People on site')` — this app's own field-label widget, which takes its words
    # positionally rather than as a named parameter. Every form uses it, so leaving it out of this
    # list left every field label in English under a Tamil heading.
    source = re.sub(r"(\b_Label\(\s*)(['\"])((?:[^'\"\\]|\\.)*?)\2", wrap, source)
    source = re.sub(
        r"(\b(?:%s):\s*)(['\"])((?:[^'\"\\]|\\.)*?)\2" % '|'.join(PROSE_PARAMS),
        wrap,
        source,
    )
    return source, count[0]


def add_import(path, source):
    """`t` comes from core/i18n.dart; work out how to reach it from here."""
    if '/i18n.dart' in source:
        return source
    relative = os.path.relpath(path, ROOT).replace('\\', '/')
    depth = relative.count('/')
    target = ('../' * depth) + 'core/i18n.dart'
    imports = list(re.finditer(r'^import .*?;$', source, re.M))
    if not imports:
        return source
    last = imports[-1]
    return source[: last.end()] + ("\nimport '%s';" % target) + source[last.end() :]


def drop_invalid_consts():
    """Ask the analyser which `const` keywords are now wrong, and remove exactly those."""
    for attempt in range(15):
        result = subprocess.run(
            ['flutter', 'analyze', '--no-pub', ROOT],
            capture_output=True,
            text=True,
            shell=True,
        )
        hits = re.findall(
            r'- (lib[\\/][^\s]+\.dart):(\d+):(\d+) - (?:const_with_non_const|'
            r'const_constructor_param_type_mismatch|invalid_constant|'
            r'non_constant_list_element|non_constant_map_value|const_eval_method_invocation)',
            result.stdout,
        )
        if not hits:
            return attempt
        # Back to front within each file, so earlier offsets stay valid.
        by_file = {}
        for path, line, column in hits:
            by_file.setdefault(path.replace('\\', '/'), []).append((int(line), int(column)))

        for path, positions in by_file.items():
            source = io.open(path, encoding='utf-8').read()
            starts = line_starts(source)
            offsets = sorted(
                {starts[line - 1] + column - 1 for line, column in positions}, reverse=True
            )
            for offset in offsets:
                # The `const` is often lines above the expression it spoils -
                # `const EmptyNote(` on one line, `title: t('...')` two lines down - and the
                # analyser reports the call, not the keyword. So this searches all the text before
                # the offending offset rather than just its line.
                keyword = None
                for match in re.finditer(r'\bconst\b', source[:offset]):
                    # Never a top-level `const _slides = [...]`. That is a declaration, not a
                    # widget: stripping its `const` leaves invalid Dart, and the real fix is that a
                    # module-level constant should keep its English and be translated where it is
                    # rendered — the same rule the web app settled on.
                    line_start = source.rfind(chr(10), 0, match.start()) + 1
                    if source[line_start : match.start()].strip() == '':
                        if re.match(r'\s*const\s+\w+\s*=', source[line_start : match.end() + 40]):
                            continue
                    keyword = match
                if keyword is None:
                    continue
                end = keyword.end()
                if source[end : end + 1] == ' ':
                    end += 1
                source = source[: keyword.start()] + source[end:]
            io.open(path, 'w', encoding='utf-8', newline=chr(10)).write(source)
    return -1


def main():
    keys = load_keys()
    files = 0
    strings = 0

    for base, _, names in os.walk(ROOT):
        for name in names:
            if not name.endswith('.dart') or name.startswith('i18n'):
                continue
            path = os.path.join(base, name)
            original = io.open(path, encoding='utf-8').read()
            rewritten, count = rewrite(original, keys)
            if count == 0:
                continue
            rewritten = add_import(path, rewritten)
            files += 1
            strings += count
            if APPLY:
                io.open(path, 'w', encoding='utf-8', newline='\n').write(rewritten)

    print('%d strings wrapped in %d files%s' % (strings, files, '' if APPLY else ' (dry run)'))

    if APPLY:
        rounds = drop_invalid_consts()
        if rounds < 0:
            print('the analyser is still unhappy after 15 rounds; look at it by hand')
        else:
            print('const keywords removed in %d round(s)' % rounds)


if __name__ == '__main__':
    main()
