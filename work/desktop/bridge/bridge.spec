from pathlib import Path

server = Path(SPECPATH).parents[2] / 'outputs' / 'daguan_server.py'
analysis = Analysis([str(server)], runtime_hooks=[str(Path(SPECPATH) / 'tls.py')])
archive = PYZ(analysis.pure)
program = EXE(
    archive, analysis.scripts, [], exclude_binaries=True,
    name='math2-bridge', console=True, target_arch='arm64',
)
bundle = COLLECT(program, analysis.binaries, analysis.datas, name='bridge')
