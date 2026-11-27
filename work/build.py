"""Build the practice website from a pinned upstream or a local copy of it."""
import argparse
import json
from pathlib import Path
import re
import shutil
import tempfile
from urllib.request import urlopen
from zipfile import ZipFile

from build_content import REVISION, build_content

WORK = Path(__file__).resolve().parent
OUTPUT = WORK.parent / "outputs" / "数二真题进度.html"
YEARS = range(2026, 2000, -1)
CATALOG = "2000—2026年考研数学二题型分类.md"
ARCHIVE = f"https://codeload.github.com/wangziyu1234/Mathematics-II-/zip/{REVISION}"


def catalogue(source):
    chapters = {}
    topics = {}
    for line in (source / CATALOG).read_text(encoding="utf-8").splitlines():
        chapter = re.match(r"^## [一二三四五六七八九十]+、(.+)$", line)
        if chapter:
            identifier = str(len(chapters) + 1)
            chapters[identifier] = {"name": chapter[1], "subject": "calc" if int(identifier) <= 8 else "linear", "topics": {}}
        topic = re.match(r"^### (\d+\.\d+) (.+)$", line)
        if topic:
            topic_id, name = topic.groups()
            assert topic_id.split(".")[0] == identifier
            chapters[identifier]["topics"][topic_id] = name
        entry = re.match(r"^\| \[(20\d{2})\.(\d+)\]\(", line)
        if entry:
            key = tuple(map(int, entry.groups()))
            if key in topics:
                raise ValueError(f"分类中重复的题号 {key}")
            topics[key] = topic_id
    return chapters, topics


def question_groups(headings):
    sectioned = len(headings) > 3
    typed = headings[:2] if sectioned else headings
    groups = []
    for heading in typed:
        kind = re.search(r"(选择题|填空题|解答题)", heading)
        count = re.search(r"共\s*(\d+)\s*小题", heading)
        interval = re.search(r"(\d+)\s*[～~—－-]\s*(\d+)\s*小?题", heading)
        if not kind or not (count or interval):
            raise ValueError(f"无法读取原卷题型或题数：{heading}")
        size = int(count[1]) if count else int(interval[2]) - int(interval[1]) + 1
        groups.append([kind[1], size])
    if sectioned:
        groups.append(["解答题", len(headings) - 2])
    return groups, sectioned


def blank_papers(source, chapters, topics):
    papers = []
    for year in YEARS:
        raw = (source / f"{year}年考研数学二试题.md").read_text(encoding="utf-8")
        groups, sectioned = question_groups(re.findall(r"^## (.+)$", raw, re.M))
        count = sum(size for _, size in groups)
        ids = [topics[year, i] for i in range(1, count + 1)]
        if sum(y == year for y, _ in topics) != count:
            raise ValueError(f"{year} 年原卷题数与知识点目录不一致")
        linear = [n for n, topic in enumerate(ids, 1) if chapters[topic.split(".")[0]]["subject"] == "linear"]
        papers.append({"year": year, "groups": groups, "sectioned": sectioned, "topics": ids,
                       "linear": linear, "states": "." * count, "marked": 0})
    return papers


def build(source):
    chapters, topics = catalogue(source)
    papers = blank_papers(source, chapters, topics)
    contents = build_content(source, papers)
    if len(contents) != 586:
        raise ValueError(f"2001–2026 年应有 586 题，读到 {len(contents)} 题")
    page = (WORK / "site.html").read_text(encoding="utf-8")
    for slot, file in (("RECORD_JS", "record.js"), ("RECORD_CSS", "record.css"), ("PRACTICE_JS", "practice.js"), ("PRACTICE_CSS", "practice.css")):
        page = page.replace(f"__{slot}__", (WORK / file).read_text(encoding="utf-8"))
    for slot, data in (("RECORDS", papers), ("TOPICS", chapters), ("CONTENT", contents)):
        value = json.dumps(data, separators=(",", ":"), ensure_ascii=False).replace("<", "\\u003c")
        page = page.replace(f"__{slot}__", value)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=OUTPUT.parent, delete=False) as handle:
        temporary_page = Path(handle.name)
        try:
            handle.write(page)
        except BaseException:
            temporary_page.unlink(missing_ok=True)
            raise
    temporary_page.replace(OUTPUT)
    print(f"已构建 {len(papers)} 份试卷、{len(contents)} 题，初始进度全部未标记。\n{OUTPUT}")


def download_source(folder):
    archive = folder / "source.zip"
    with urlopen(ARCHIVE, timeout=60) as response, archive.open("wb") as file:
        shutil.copyfileobj(response, file)
    prefix = f"Mathematics-II--{REVISION}/"
    files = [CATALOG]
    for year in YEARS:
        files.extend((f"{year}年考研数学二试题.md", f"{year}年考研数学二答案与解析.md"))
    with ZipFile(archive) as source:
        files.extend(name[len(prefix):] for name in source.namelist()
                     if name.startswith(prefix) and re.fullmatch(r"_题图/[0-9.]+\.png", name[len(prefix):]))
        for name in files:
            target = folder / name
            target.parent.mkdir(exist_ok=True)
            target.write_bytes(source.read(prefix + name))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="本地 Mathematics-II 题库根目录")
    args = parser.parse_args()
    if args.source:
        build(args.source.resolve())
        return
    with tempfile.TemporaryDirectory(prefix="math2-source-") as folder:
        checkout = Path(folder)
        download_source(checkout)
        build(checkout)


if __name__ == "__main__":
    main()
