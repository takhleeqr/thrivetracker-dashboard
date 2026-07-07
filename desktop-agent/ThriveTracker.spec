# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ["agent.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        "pynput.keyboard._win32",
        "pynput.mouse._win32",
        "pystray._win32",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    [],
    name="ThriveTracker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # Reliability matters more than a smaller EXE for VA rollouts.
    # UPX-compressed one-file builds can cause random native-module extraction
    # failures on some Windows PCs, especially for bundled Pillow binaries.
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="assets/icon.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="ThriveTracker",
)
