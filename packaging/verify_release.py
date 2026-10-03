"""Verify a built Windows directory and emit a checksummed release manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import zipfile


FORBIDDEN_NAMES = {"SAVEDATA.BIN", "BACKUP.BIN", "snapshot-manifest.json"}
EXPECTED_KATANA_SHA256 = "677F49B8F7B271303773C4F96D4772320A90FB87F22D510DC1B08682732AFA0E"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def verify_release(root: Path) -> dict[str, object]:
    root = root.resolve()
    executable = root / "仁王2存档伴侣.exe"
    katana = root / "_internal" / "agent" / "tools" / "katana" / "katana-savedata-resigner-cli.exe"
    required = (
        executable,
        root / "Nioh2Console.exe",
        root / "Start-Sync-Test.cmd",
        root / "Start-Browser-Mode.cmd",
        root / "WINDOWS-APP-TEST.md",
        root / "启动手机模式.cmd",
        root / "Start-Phone-Mode.cmd",
        root / "TESTING-GUIDE.txt",
        katana,
        root / "_internal" / "dist" / "index.html",
        root / "_internal" / "dist" / "manifest.webmanifest",
        root / "_internal" / "webview" / "js" / "api.js",
    )
    missing = [str(path.relative_to(root)) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError(f"发布目录缺少文件：{', '.join(missing)}")
    for launcher in (root / "启动手机模式.cmd", root / "Start-Phone-Mode.cmd"):
        launcher_bytes = launcher.read_bytes()
        if not launcher_bytes.isascii() or b"*.exe" not in launcher_bytes or b"--lan" not in launcher_bytes:
            raise RuntimeError("手机启动脚本必须为纯 ASCII，并自动定位同目录 EXE。")
    if sha256(katana) != EXPECTED_KATANA_SHA256:
        raise RuntimeError("发布目录中的 Katana 哈希不匹配。")

    files = [path for path in root.rglob("*") if path.is_file() and path.name != "release-manifest.json"]
    forbidden = [str(path.relative_to(root)) for path in files if path.name in FORBIDDEN_NAMES or ".local" in path.parts]
    if forbidden:
        raise RuntimeError(f"发布目录混入存档数据：{', '.join(forbidden)}")

    records = [
        {"path": path.relative_to(root).as_posix(), "size": path.stat().st_size, "sha256": sha256(path)}
        for path in sorted(files, key=lambda item: item.relative_to(root).as_posix())
    ]
    package = json.loads((Path(__file__).parents[1] / "package.json").read_text(encoding="utf-8"))
    return {
        "schemaVersion": "1.0.0",
        "application": "仁王2存档伴侣",
        "version": package["version"],
        "writeBackSupported": False,
        "fileCount": len(records),
        "totalBytes": sum(record["size"] for record in records),
        "files": records,
    }


def verify_archive(archive: Path, expected_root: str = "Nioh2SaveCompanion") -> dict[str, object]:
    """Reject archives that leak save data or have an unexpected layout."""
    with zipfile.ZipFile(archive) as bundle:
        names = [name.replace("\\", "/") for name in bundle.namelist() if not name.endswith("/")]
        launcher_name = f"{expected_root}/启动手机模式.cmd"
        launcher_bytes = bundle.read(launcher_name) if launcher_name in names else b""
    forbidden = [
        name for name in names
        if Path(name).name in FORBIDDEN_NAMES or ".local" in Path(name).parts
    ]
    if forbidden:
        raise RuntimeError(f"ZIP 混入存档数据：{', '.join(forbidden)}")
    roots = {name.split("/", 1)[0] for name in names}
    if roots != {expected_root}:
        raise RuntimeError(f"ZIP 顶层目录异常：{', '.join(sorted(roots))}")
    required = {
        f"{expected_root}/仁王2存档伴侣.exe",
        f"{expected_root}/Nioh2Console.exe",
        f"{expected_root}/Start-Sync-Test.cmd",
        f"{expected_root}/Start-Browser-Mode.cmd",
        f"{expected_root}/WINDOWS-APP-TEST.md",
        f"{expected_root}/_internal/webview/js/api.js",
        f"{expected_root}/启动手机模式.cmd",
        f"{expected_root}/Start-Phone-Mode.cmd",
        f"{expected_root}/TESTING-GUIDE.txt",
        f"{expected_root}/release-manifest.json",
        f"{expected_root}/_internal/dist/index.html",
    }
    missing = sorted(required.difference(names))
    if missing:
        raise RuntimeError(f"ZIP 缺少文件：{', '.join(missing)}")
    ascii_launcher_name = f"{expected_root}/Start-Phone-Mode.cmd"
    with zipfile.ZipFile(archive) as bundle:
        ascii_launcher_bytes = bundle.read(ascii_launcher_name) if ascii_launcher_name in names else b""
    if (
        not launcher_bytes.isascii()
        or b"*.exe" not in launcher_bytes
        or b"--lan" not in launcher_bytes
        or not ascii_launcher_bytes.isascii()
        or b"*.exe" not in ascii_launcher_bytes
        or b"--lan" not in ascii_launcher_bytes
    ):
        raise RuntimeError("ZIP 中的手机启动脚本未通过编码兼容性校验。")
    return {"entryCount": len(names), "size": archive.stat().st_size, "sha256": sha256(archive)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("release", type=Path)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    manifest = verify_release(args.release)
    output = args.release / "release-manifest.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"发布校验通过：{manifest['fileCount']} 个文件，{manifest['totalBytes']} 字节")
    print(output)
    if args.archive:
        archive_report = verify_archive(args.archive.resolve())
        print(
            f"ZIP 校验通过：{archive_report['entryCount']} 个文件，"
            f"SHA-256 {archive_report['sha256']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
