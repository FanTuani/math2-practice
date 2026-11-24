"""Extract questions, scores and solutions from a local Mathematics-II checkout."""
import base64
import re
from urllib.parse import quote

REVISION = "ce9b8048d1309514dc9274e435f9731f67e92611"
UPSTREAM = "https://github.com/wangziyu1234/Mathematics-II-"
REPO = f"{UPSTREAM}/blob/{REVISION}/"
NUMBER = re.compile(r"^(?:###\s*)?(?:[(（](\d+)[)）]|(\d+)\.)[ \t]*", re.M)
QHEAD = re.compile(r"^\*\*(\d+)\.\s*（(\d{4})\.(\d+)(?:；原卷([^）]+))?）(.*?)\*\*\s*$", re.M)
IMAGE = re.compile(r"(!\[[^\]]*\]\()(_题图/[^)]+\.png)\)")
LETTERS = "ABCD"
SECTIONS = "一 二 三 四 五 六 七 八 九 十 十一 十二".split()


def numbered(text, first, count):
    """Split at full question numbers only, preserving nested subquestion numbering."""
    expected = list(range(first, first + count))
    matches = [m for m in NUMBER.finditer(text) if int(m[1] or m[2]) in expected]
    assert [int(m[1] or m[2]) for m in matches] == expected, (expected, text[:80])
    parts = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        parts.append(text[m.end():end].strip())
    return parts


def clean_stem(text):
    text = re.sub(r"(?m)^---[ \t]*$", "", text)
    text = re.sub(r"^（本题满分\s*\d+\s*分）\s*", "", text.strip())
    # Continuations in Markdown numbered lists can become spurious code blocks
    # when removed from their original list.
    return re.sub(r"(?m)^ {1,4}(?=\S)", "", text).strip()


def stems(source, paper):
    year = paper["year"]
    raw = (source / f"{year}年考研数学二试题.md").read_text(encoding="utf-8")
    parts = re.split(r"(?m)^## ([^\n]+)\n", raw)
    sections = list(zip(parts[1::2], parts[2::2], strict=True))
    result = []
    for index, (heading, body) in enumerate(sections):
        total_match = re.search(r"(?:满分|共)\s*(\d+)\s*分", heading)
        assert total_match, (year, heading)
        total = int(total_match[1])
        if paper.get("sectioned") and index >= 2:
            # Each remaining section is one independently scored original question.
            items = [(body, total)]
        else:
            count = paper["groups"][index][1]
            first = 1 if paper.get("sectioned") else len(result) + 1
            texts = numbered(body, first, count)
            uniform = re.search(r"每(?:小)?题\s*(\d+)\s*分", heading)
            items = []
            for position, text in enumerate(texts, first):
                mark = uniform or re.match(r"（本题满分\s*(\d+)\s*分）", text)
                assert mark, (year, position, "原卷缺少逐题分值")
                items.append((text, int(mark[1])))
        assert sum(score for _, score in items) == total, (year, heading, items)
        result.extend((clean_stem(text), score) for text, score in items)
    assert sum(score for _, score in result) == (100 if year <= 2002 else 150), year
    return result

def embed_images(source, text):
    def embed(match):
        image = (source / match[2]).read_bytes()
        assert image.startswith(b"\x89PNG\r\n\x1a\n"), match[2]
        return match[1] + "data:image/png;base64," + base64.b64encode(image).decode() + ")"

    return IMAGE.sub(embed, text)


def essay_summaries(preface):
    result = {}
    for line in preface.splitlines():
        numbered_line = re.match(r"^(\d+)\.\s*(.+)", line)
        old_number = re.match(r"^[一二三四五六七八九十]+（\d{4}\.(\d+)）：(.+)", line)
        match = numbered_line or old_number
        if match:
            result[int(match[1])] = match[2]
        elif line.startswith("> 解答题："):
            for entry in re.split(r"；(?=\d+\.)", line.removeprefix("> 解答题：")):
                n, answer = entry.split(".", 1)
                result[int(n)] = answer.strip()
    return result


def solutions(source, paper):
    year = paper["year"]
    text = (source / f"{year}年考研数学二答案与解析.md").read_text(encoding="utf-8")
    summaries = essay_summaries(text.split("## 一、")[0])
    solution_sections = re.split(r"(?m)^## [^\n]+\n", text)
    result = []
    for section in solution_sections:
        headings = list(QHEAD.finditer(section))
        for idx, heading in enumerate(headings):
            n = len(result) + 1
            assert (int(heading[1]), int(heading[2]), int(heading[3])) == (n, year, n)
            if paper.get("sectioned"):
                a, b = (g[1] for g in paper["groups"][:2])
                label = ("一·" + str(n) if n <= a else "二·" + str(n - a) if n <= a + b
                         else SECTIONS[n - a - b + 1])
                assert heading[4] == label, (year, n, heading[4], label)
            end = headings[idx + 1].start() if idx + 1 < len(headings) else len(section)
            explanation = section[heading.end():end].strip()
            title = heading[5]
            if explanation.startswith("**答案："):
                # Some answers contain a multi-line matrix, followed by a first step.
                if explanation.startswith("**答案：**"):
                    start = re.search(r"(?m)^\*\*(?:（1）)?第一步", explanation)
                    assert start, (year, n)
                    answer = explanation[:start.start()].removeprefix("**答案：**").strip()
                    explanation = explanation[start.start():]
                else:
                    answer, explanation = explanation.split("\n", 1)
                    answer = answer.removeprefix("**答案：").removesuffix("**").strip()
            else:
                answer = summaries.get(n, title.removeprefix("答案：").strip())
            assert answer and explanation, (year, n)
            result.append((answer.strip(), explanation.strip()))
    assert len(result) == len(paper["states"]), year
    return result


def choice_fields(source, stem, answer):
    choices = re.split(r"(?:^|(?<=\s)|(?<=;))[(（]([A-D])[)）]", stem, flags=re.M)
    if len(choices) == 1:
        assert "选项图" in stem or "选项图像" in stem, stem[:150]
        prompt, options = stem, [""] * 4
    else:
        assert choices[1::2] == list(LETTERS), (choices[1::2], stem[:160])
        prompt = choices[0].strip()
        options = [re.sub(r"(?:\s|&emsp;)+$", "", s).strip() for s in choices[2::2]]
        assert all(options)
    letter = re.match(r"^\s*(?:选(?:项)?\s*)?(?:\$)?([A-D])(?:\$)?(?=[\s。.,，；：]|$)", answer)
    assert letter, answer
    return {"prompt": embed_images(source, prompt), "options": [embed_images(source, s) for s in options],
            "correctOption": letter[1]}


def build_content(source, papers):
    content = {}
    for paper in papers:
        year = paper["year"]
        questions, answers = stems(source, paper), solutions(source, paper)
        kinds = [name for name, size in paper["groups"] for _ in range(size)]
        assert len(questions) == len(answers) == len(kinds) == len(paper["states"]), year
        for n, ((stem, points), (answer, explanation), kind) in enumerate(zip(questions, answers, kinds), 1):
            key = f"{year}-{n}"
            assert stem and len(explanation) > 35, key
            item = {"stem": embed_images(source, stem), "answer": answer, "explanation": explanation, "points": points}
            item["answerSource"] = REPO + quote(f"{year}年考研数学二答案与解析.md")
            if kind == "选择题":
                try:
                    item.update(choice_fields(source, stem, answer))
                except AssertionError as e:
                    raise ValueError(f"{key}: {e}") from e
            content[key] = item
    return content
