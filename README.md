# 数二真题练习

按年份或知识点练习 2001–2026 年考研数学二真题，共 26 份原卷、586 题。点开矩阵中的一道题或题海中的一个专题，即可看原题、做选择题、展开解析，并逐题标记「掌握」「不熟练」「不会」。列表和单题模式都支持浏览器前进、后退和刷新恢复。

## 在自己电脑上使用

需要 Python 3.10 或以上版本。先下载本仓库源码并解压，或克隆仓库。在仓库根目录运行以下命令，首次构建需要联网下载固定版本的原卷、题图、解析和分类。构建器只使用 Python 标准库。

```sh
python3 work/build.py
```

如果已有相同版本的上游题库，可以直接指定它的根目录，离线生成相同的站点。

```sh
python3 work/build.py --source "/path/to/Mathematics-II-"
```

- **离线练习**。用较新的 Chrome、Edge 或 Electron 桌面版打开。浏览器可以直接打开 `outputs/数二真题进度.html`，请让相邻的 `练习资源` 文件夹随页面一起移动。所有题目、题图和数学字体均在本地。
- **与大观园同步**。运行下面的本地服务，打开页面右上角的「连接大观园」，用自己的账号授权。macOS 也可以双击 `outputs/启动数二练习.command`。Windows 可将示例中的 `python3` 换成 `py -3`。

```sh
python3 outputs/daguan_server.py
```

服务只监听本机。浏览器请打开 [本机练习站](http://127.0.0.1:17846/)。

每份新构建都从全部题目未标记开始。本地掌握标记和收藏保存在当前浏览器或桌面应用的存储区。同一份 HTML 在不同浏览器、不同本机端口或桌面应用中打开，各自有独立的本地进度。

## 打包 macOS 桌面版

先按上面的步骤生成站点。桌面打包还需要Node.js 22.12 或以上版本、npm、Python 3.11 和 macOS 命令行开发工具。脚本默认调用 `python3.11`，可以用 `BRIDGE_PYTHON` 指定可创建虚拟环境的兼容 Python。首次打包会下载 Electron 和 PyInstaller。

```sh
npm --prefix work/desktop ci
npm --prefix work/desktop run build
open "outputs/数二真题练习.app"
```

桌面构建面向 Apple Silicon Mac。构建脚本准备本机同步服务并将前端一起放入应用。应用与同一台 Mac 上的本机练习服务可共用大观园授权。其他操作系统可以直接使用浏览器版。

## 大观园进度和 MCP

练习服务本身就是大观园 MCP 的客户端。连接时可选只读权限 `learning.read`，也可以授权 `learning.write`，把掌握状态和收藏写回自己的账号。网页通过本机服务走 OAuth 授权码和 PKCE 流程，每个人都用自己的浏览器登录。网页检查当前题和最近发生变化的已关联题目。题号匹配有歧义时，可在界面中选择对应题目；未连接时仍能在本地练习。远端状态冲突会显示在题卡上，让你决定采用哪一边。

如果想让自己的 AI 助手分析复习进度，可在支持远程 HTTP MCP 和 OAuth 的客户端添加 `https://cxyonly.fans/mcp`，完成该客户端自己的授权。题库构建从公开原卷资料读取，MCP 提供按需的个人学习数据。网页和 AI 客户端各自管理登录，无需从另一个客户端导出 token。

本机服务使用 `connection.json` 存放授权和题目关联。macOS 默认目录为 `~/Library/Application Support/数二真题练习/`，Windows 在当前用户的 LocalAppData 下，Linux 在当前用户的 XDG 状态目录下。可以用 `--state-dir` 指定其他目录。分享源码时只分享仓库地址，保留自己的授权文件和本地进度。

## 可以直接发给同学的提示词

> 请帮我在自己的电脑上安装 [数二真题练习](https://github.com/FanTuani/math2-practice)。先阅读 README，检查 Python 版本，从固定上游构建一份全部未标记的本地题库，并实际打开一个年份和一道有解析的题验证。默认使用浏览器版；如果我在 Apple Silicon Mac 上并要求桌面版，再构建 Electron 应用。需要同步时请打开本机站点，让我自己在大观园完成 OAuth。若我要你分析个人学习记录，请在你自己的客户端连接大观园 MCP 并提示我授权。不要索取账号密码或复制他人的授权文件。

前端已经附带离线公式渲染资源。修改渲染器源码后，可用 `npm --prefix work/render-build ci` 和 `npm --prefix work/render-build run build` 重新生成。

## 来源与许可

本项目的网页、构建脚本和同步服务采用 MIT 许可。公式与 Markdown 渲染器的第三方许可随前端资源提供。[MIT 许可](LICENSE) · [第三方许可](outputs/练习资源/第三方许可.txt)

原卷、解析、题图和分类取自独立的 Mathematics-II- 仓库，固定版本为 `ce9b8048d1309514dc9274e435f9731f67e92611`。该版本未列出单独的再分发许可。本仓库只提供读取和构建工具，用户在自己电脑上生成带题库的 HTML 或应用。上游内容的权利归相应权利人所有。[固定版本与资料说明](https://github.com/wangziyu1234/Mathematics-II-/tree/ce9b8048d1309514dc9274e435f9731f67e92611)
