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
PROSE_PARAMS = (
    'hintText',
    'labelText',
    'title',
    'body',
    'label',
    'helperText',
    'tooltip',
    'message',
    # Added after an audit found 155 hard-coded strings this list had never looked at. Kept in step
    # with `i18n_extract.py`, which is the script that finds what is still missing.
    'addLabel',
    'confirmLabel',
)


DECLARATION = re.compile(r'\s*(?:static\s+)?const\s+\w+\s*=')


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


# One string literal, or a run of adjacent ones.
#
# Dart joins `'a ' 'b'` into `'ab'` with no operator between them, and this app wraps every long
# sentence that way to keep lines under 100 characters. Matching a single literal therefore matched
# only the first fragment of most real sentences — wrapping that one in `t()` left the rest dangling
# and turned 28 files into syntax errors. The run has to be matched and replaced whole.
_ONE = r"""(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")"""
_RUN = r"(%s(?:\s*%s)*)" % (_ONE, _ONE)

_LITERAL = re.compile(r"""'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)\"""")


def join_run(run):
    """The text Dart would end up with, and whether the run spans more than one literal."""
    parts = [a if a is not None else b for a, b in _LITERAL.findall(run)]
    return ''.join(unescape(p) for p in parts), len(parts)


def const_spans(source):
    """Where every `const name = ...;` declaration begins and ends.

    Found by counting brackets from the `=` to the semicolon that closes it, which handles the
    multi-line list literals this app writes its slide and tab tables as.
    """
    spans = []
    for match in DECLARATION.finditer(source):
        index = source.find('=', match.start())
        if index == -1:
            continue
        depth = 0
        while index < len(source):
            char = source[index]
            if char in '([{':
                depth += 1
            elif char in ')]}':
                depth -= 1
            elif char == ';' and depth <= 0:
                break
            index += 1
        spans.append((match.start(), index))
    return spans


def rewrite(source, keys):
    count = [0]

    # Spans of the file that are const declarations. The dictionary is consulted at render, never at
    # definition: a `const _slides = [...]` is built when the module loads, with no language to read,
    # so it keeps its English and the widget that renders it calls `t()`.
    frozen = const_spans(source)

    def wrap(match):
        prefix, run = match.group(1), match.group(2)
        if any(start <= match.start() < end for start, end in frozen):
            return match.group(0)
        text, parts = join_run(run)
        if text not in keys:
            return match.group(0)
        count[0] += 1
        # A multi-part run collapses to one literal, because `t('a ' 'b')` is a call with the joined
        # string — correct, but unreadable, and the key is the joined string anyway.
        if parts > 1:
            escaped = (
                text.replace('\\', '\\\\').replace("'", "\\'").replace('$', '\\$')
            )
            return "%st('%s')" % (prefix, escaped)
        return '%st(%s)' % (prefix, run)

    for widget in ('Text', '_Label', 'SectionLabel'):
        source = re.sub(r"(\b%s\(\s*)%s" % (widget, _RUN), wrap, source)
    source = re.sub(
        r"(\b(?:%s):\s*)%s" % ('|'.join(PROSE_PARAMS), _RUN),
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
                    # `const _slides = [...]` and `static const _key = '...'` are declarations, not
                    # widgets. Stripping their `const` leaves invalid Dart. The first version only
                    # guarded the unindented case and duly broke `static const` inside a class.
                    if DECLARATION.match(source[line_start : match.end() + 40]):
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
